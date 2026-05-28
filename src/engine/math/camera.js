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

export const FRAME_CAMERA_MODES = Object.freeze([
  { id: 'auto', label: 'Auto Rotate' },
  { id: 'cockpit', label: 'Interior Cockpit' },
  { id: 'top', label: 'Top' },
  { id: 'side', label: 'Side' },
  { id: 'back', label: 'Back' },
  { id: 'frontAngle', label: 'Front Angle' },
  { id: 'rearAngle', label: 'Rear Angle' },
])

export const DEFAULT_FRAME_CAMERA_SETTINGS = Object.freeze({
  selectedMode: 'auto',
  mobileDistanceMultiplier: 1.4,
  editorPreviewDevice: 'desktop',
  editorPanEnabled: true,
  // Center-of-mass offset (world units) applied to the geometric center. Acts
  // as the pivot for the 360° orbit and the framing target of external presets.
  orbitCenter: [0, 0, 0],
  presets: {
    auto: { offset: [0, 0, 0], targetOffset: [0, 0, 0], distanceScale: 1 },
    cockpit: { offset: [0, 0, 0], targetOffset: [0, 0, 0], distanceScale: 1 },
    top: { offset: [0, 0, 0], targetOffset: [0, 0, 0], distanceScale: 1 },
    side: { offset: [0, 0, 0], targetOffset: [0, 0, 0], distanceScale: 1 },
    back: { offset: [0, 0, 0], targetOffset: [0, 0, 0], distanceScale: 1 },
    frontAngle: { offset: [0, 0, 0], targetOffset: [0, 0, 0], distanceScale: 1 },
    rearAngle: { offset: [0, 0, 0], targetOffset: [0, 0, 0], distanceScale: 1 },
  },
})

function vectorFromArray(value, fallback = [0, 0, 0]) {
  const source = Array.isArray(value) ? value : fallback
  return new THREE.Vector3(source[0] ?? 0, source[1] ?? 0, source[2] ?? 0)
}

function getPresetSettings(cameraSettings, mode) {
  return {
    ...DEFAULT_FRAME_CAMERA_SETTINGS.presets[mode],
    ...(cameraSettings?.presets?.[mode] ?? {}),
  }
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function fitDistanceFromSize(size, fovDeg, aspect, paddingFactor = 0.52) {
  const width = Math.max(size.x, 0.01)
  const height = Math.max(size.y, 0.01)
  const depth = Math.max(size.z, 0.01)
  const fit = computeAutoFitCamera({ width, height, depth }, fovDeg, aspect, paddingFactor)
  return fit.distance
}

export function computeFrameCameraPreset({
  mode = 'auto',
  frameInfo = null,
  fovDeg = 40,
  aspect = 16 / 9,
  isMobile = false,
  cameraSettings = null,
}) {
  const rawCenter = vectorFromArray(frameInfo?.center, [0, 0.8, 0])
  const orbitCenter = vectorFromArray(cameraSettings?.orbitCenter, [0, 0, 0])
  const center = rawCenter.clone().add(orbitCenter)
  const size = vectorFromArray(frameInfo?.size, [6, 2, 3])
  const settings = getPresetSettings(cameraSettings, mode)
  const offset = vectorFromArray(settings.offset)
  const targetOffset = vectorFromArray(settings.targetOffset)
  const height = Math.max(size.y, 0.8)
  const depth = Math.max(size.z, 1)
  const mobileMultiplier = finiteNumber(cameraSettings?.mobileDistanceMultiplier, DEFAULT_FRAME_CAMERA_SETTINGS.mobileDistanceMultiplier)
  const distanceScale = Math.max(0.35, finiteNumber(settings.distanceScale, 1))
  const baseDistance = fitDistanceFromSize(size, fovDeg, aspect, 0.6) * (isMobile ? mobileMultiplier : 1) * distanceScale
  const target = center.clone().add(targetOffset)

  const dirs = {
    auto: new THREE.Vector3(0.78, 0.38, 1),
    frontAngle: new THREE.Vector3(-0.9, 0.36, 1),
    rearAngle: new THREE.Vector3(-0.95, 0.34, -1),
    side: new THREE.Vector3(1, 0.26, 0),
    back: new THREE.Vector3(0, 0.32, -1),
    top: new THREE.Vector3(0.03, 1, 0.03),
  }

  if (mode === 'cockpit') {
    const cockpitTarget = rawCenter.clone().add(targetOffset)

    const cockpitPosition = cockpitTarget.clone().add(new THREE.Vector3(0.16 * size.x, 0.04 * height, Math.max(depth * 0.32, 1.05))).add(offset)
    return {
      position: cockpitPosition.toArray(),
      target: cockpitTarget.toArray(),
      minDistance: 0.05,
      maxDistance: Math.max(baseDistance * 0.85, 2.4),
      autoRotate: false,
    }
  }

  const dir = (dirs[mode] ?? dirs.auto).clone().normalize()
  const distance = mode === 'top' ? baseDistance * 0.92 : baseDistance
  const position = target.clone().add(dir.multiplyScalar(distance)).add(offset)

  return {
    position: position.toArray(),
    target: target.toArray(),
    minDistance: 0.05,
    maxDistance: Math.max(baseDistance * 1.65, 8),
    autoRotate: mode === 'auto',
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
