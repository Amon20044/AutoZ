/**
 * @module engine/math/camera
 * Camera math: bounding sphere, auto-fit distance, FOV, near/far, focus.
 */
import * as THREE from 'three'

/** Bounding sphere radius: r = ½√(W²+H²+D²) · S */
export function boundingSphereRadius(W, H, D, scale = 1) {
  return 0.5 * Math.sqrt(W * W + H * H + D * D) * scale
}

/**
 * Camera distance for auto-fit.
 * d_v = (H/2) / tan(FOVv/2)
 * d_h = (W/2) / tan(FOVh/2)
 * d = max(d_v, d_h) + padding
 */
export function autoFitDistance(W, H, fovDeg, aspect, paddingFactor = 0.35) {
  const fovRad = THREE.MathUtils.degToRad(fovDeg)
  const dv = (H / 2) / Math.tan(fovRad / 2)
  const fovH = 2 * Math.atan(Math.tan(fovRad / 2) * aspect)
  const dh = (W / 2) / Math.tan(fovH / 2)
  const r = boundingSphereRadius(W, H, W) // approximate D ≈ W for cars
  return Math.max(dv, dh) + r * paddingFactor
}

/**
 * Full auto-fit camera params from normalized dimensions.
 * @param {{ width: number, height: number, depth: number }} dims
 * @param {number} fovDeg
 * @param {number} aspect - viewport width / height
 * @param {number} [paddingFactor=0.35]
 */
export function computeAutoFitCamera(dims, fovDeg = 40, aspect = 16 / 9, paddingFactor = 0.35) {
  const { width: W, height: H, depth: D } = dims
  const fovRad = THREE.MathUtils.degToRad(fovDeg)
  const dv = (H / 2) / Math.tan(fovRad / 2)
  const fovH = 2 * Math.atan(Math.tan(fovRad / 2) * aspect)
  const dh = (W / 2) / Math.tan(fovH / 2)
  const r = boundingSphereRadius(W, H, D)
  const d = Math.max(dv, dh) + r * paddingFactor

  return {
    position: [d * 0.8, d * 0.45, -d],
    target: [0, H * 0.45, 0],
    near: Math.max(0.01, d - 2 * r),
    far: d + 4 * r,
    distance: d,
    boundingSphereRadius: r,
    fov: fovDeg,
  }
}

/**
 * Compute focus camera position for a specific part.
 * Moves camera closer, centering on the part's bounding box.
 *
 * @param {THREE.Box3} partBox - Part world bbox
 * @param {THREE.Vector3} currentCamPos - Current camera position
 * @param {number} fovDeg
 * @param {number} aspect
 * @param {number} [padding=0.5]
 */
export function computeFocusCamera(partBox, currentCamPos, fovDeg = 40, aspect = 16 / 9, padding = 0.5) {
  const center = partBox.getCenter(new THREE.Vector3())
  const size = partBox.getSize(new THREE.Vector3())
  const r = boundingSphereRadius(size.x, size.y, size.z)
  const fovRad = THREE.MathUtils.degToRad(fovDeg)
  const dist = (r + padding) / Math.tan(fovRad / 2)

  // Direction from target to current camera, keep approach angle
  const dir = new THREE.Vector3().subVectors(currentCamPos, center).normalize()
  const position = new THREE.Vector3().addVectors(center, dir.multiplyScalar(dist))

  return { position: position.toArray(), target: center.toArray(), distance: dist }
}

/** Near/far from camera distance and bounding sphere */
export function computeNearFar(cameraDistance, radius) {
  return {
    near: Math.max(0.01, cameraDistance - 2 * radius),
    far: cameraDistance + 4 * radius,
  }
}

/**
 * LOD level from projected screen height.
 * h_px = (H · f) / z  where f = viewportH / (2·tan(FOV/2))
 */
export function computeLODLevel(objectHeight, distanceZ, fovDeg, viewportHeight) {
  const f = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2))
  const hPx = (objectHeight * f) / Math.max(distanceZ, 0.01)
  if (hPx > 700) return 'high'
  if (hPx > 300) return 'medium'
  return 'low'
}
