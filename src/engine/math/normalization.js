/**
 * @module engine/math/normalization
 * Model normalization math: p_final = R_forward · (S · u_s · p_raw − O)
 */
import * as THREE from 'three'

/** Canonical unit → meters scale factors */
export const UNIT_SCALES = Object.freeze({
  millimeter: 0.001, centimeter: 0.01, meter: 1.0, inch: 0.0254, foot: 0.3048,
})

/** @param {string} sourceUnit @returns {number} */
export function getUnitScale(sourceUnit) {
  const key = sourceUnit.toLowerCase().replace(/s$/, '')
  const s = UNIT_SCALES[key]
  if (s === undefined) throw new Error(`Unknown unit "${sourceUnit}". Valid: ${Object.keys(UNIT_SCALES).join(', ')}`)
  return s
}

/** World-space AABB from Object3D hierarchy */
export function computeBoundingBox(object) {
  object.updateWorldMatrix(true, true)
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  return { min: box.min.clone(), max: box.max.clone(), center, size, maxDimension: Math.max(size.x, size.y, size.z), groundY: box.min.y }
}

/** Pure bbox dims from arrays @param {number[]} min @param {number[]} max */
export function computeBBoxDimensions(min, max) {
  const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2]
  return { width: w, height: h, depth: d, maxDimension: Math.max(w, h, d), center: [(min[0]+max[0])/2, (min[1]+max[1])/2, (min[2]+max[2])/2], groundY: min[1] }
}

/** S = T / M */
export function computeScaleFactor(maxDimension, targetMaxDimension = 6.0) {
  if (maxDimension <= 0) throw new Error(`Invalid maxDimension: ${maxDimension}`)
  return targetMaxDimension / maxDimension
}

/** Offset O = [Cx·S, G·S, Cz·S] */
export function computeNormalizationOffset(bbox, scaleFactor) {
  const cx = bbox.center instanceof THREE.Vector3 ? bbox.center.x : bbox.center[0]
  const cz = bbox.center instanceof THREE.Vector3 ? bbox.center.z : bbox.center[2]
  return new THREE.Vector3(cx * scaleFactor, bbox.groundY * scaleFactor, cz * scaleFactor)
}

/** Quaternion to rotate sourceForward → targetForward. Handles parallel/anti-parallel. */
export function computeForwardRotation(sourceForward, targetForward = [0, 0, 1]) {
  const fs = new THREE.Vector3(...sourceForward).normalize()
  const ft = new THREE.Vector3(...targetForward).normalize()
  const dot = THREE.MathUtils.clamp(fs.dot(ft), -1, 1)
  const angle = Math.acos(dot)
  const q = new THREE.Quaternion()
  if (Math.abs(angle) < 1e-6) { q.identity() }
  else if (Math.abs(angle - Math.PI) < 1e-6) { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI) }
  else { q.setFromAxisAngle(new THREE.Vector3().crossVectors(fs, ft).normalize(), angle) }
  return { quaternion: q, euler: new THREE.Euler().setFromQuaternion(q, 'YXZ'), angle }
}

/** Full normalization pipeline → serializable result */
export function computeNormalization({ boundingBox, sourceUnit = 'meter', targetMaxDimension = 6.0, sourceForward = [0,0,1], targetForward = [0,0,1] }) {
  const unitScale = getUnitScale(sourceUnit)
  const toArr = (v) => v instanceof THREE.Vector3 ? [v.x, v.y, v.z] : v
  const rawMin = toArr(boundingBox.min), rawMax = toArr(boundingBox.max)
  const mMin = rawMin.map(v => v * unitScale), mMax = rawMax.map(v => v * unitScale)
  const dims = computeBBoxDimensions(mMin, mMax)
  const sf = computeScaleFactor(dims.maxDimension, targetMaxDimension)
  const offset = computeNormalizationOffset({ center: dims.center, groundY: dims.groundY }, sf)
  const rot = computeForwardRotation(sourceForward, targetForward)
  return {
    unitScale, scaleFactor: sf, combinedScale: unitScale * sf,
    centerOffset: [offset.x, offset.z], groundOffset: offset.y,
    rotation: { quaternion: rot.quaternion.toArray(), euler: [rot.euler.x, rot.euler.y, rot.euler.z] },
    boundingBoxRaw: { min: rawMin, max: rawMax },
    boundingBoxNormalized: { min: mMin.map((v,i) => v*sf - [offset.x, offset.y, offset.z][i]), max: mMax.map((v,i) => v*sf - [offset.x, offset.y, offset.z][i]) },
    dimensions: { width: dims.width*sf, height: dims.height*sf, depth: dims.depth*sf },
  }
}

/** Wraps object in a normalization group — preserves original hierarchy */
export function applyNormalization(object, norm) {
  const w = new THREE.Group()
  w.name = '__autoz_norm_wrapper'
  w.quaternion.copy(new THREE.Quaternion().fromArray(norm.rotation.quaternion))
  object.scale.setScalar(norm.combinedScale)
  object.position.set(-norm.centerOffset[0], -norm.groundOffset, -norm.centerOffset[1])
  w.add(object)
  return w
}

/** In-place normalization via matrix composition */
export function applyNormalizationInPlace(object, norm) {
  const q = new THREE.Quaternion().fromArray(norm.rotation.quaternion)
  const off = new THREE.Vector3(-norm.centerOffset[0], -norm.groundOffset, -norm.centerOffset[1]).applyQuaternion(q)
  const m = new THREE.Matrix4().compose(off, q, new THREE.Vector3(norm.combinedScale, norm.combinedScale, norm.combinedScale))
  object.applyMatrix4(m)
  object.updateWorldMatrix(true, true)
}

/** Pivot presets from mesh bbox */
export function computePivotPresets(mesh) {
  const { min: mn, max: mx, center: c } = computeBoundingBox(mesh)
  return {
    center: c.clone(), left: new THREE.Vector3(mn.x, c.y, c.z), right: new THREE.Vector3(mx.x, c.y, c.z),
    front: new THREE.Vector3(c.x, c.y, mx.z), rear: new THREE.Vector3(c.x, c.y, mn.z),
    top: new THREE.Vector3(c.x, mx.y, c.z), bottom: new THREE.Vector3(c.x, mn.y, c.z),
    frontLeft: new THREE.Vector3(mn.x, c.y, mx.z), frontRight: new THREE.Vector3(mx.x, c.y, mx.z),
    rearLeft: new THREE.Vector3(mn.x, c.y, mn.z), rearRight: new THREE.Vector3(mx.x, c.y, mn.z),
    topRear: new THREE.Vector3(c.x, mx.y, mn.z), topFront: new THREE.Vector3(c.x, mx.y, mx.z),
  }
}
