/**
 * @module engine/math/animation
 * Animation math: Rodrigues rotation, exponential damping, color lerp, blink.
 */
import * as THREE from 'three'

export const DEFAULT_FRAME_DT = 1 / 60
export const MAX_STABLE_DT = 1 / 30

export function stableDelta(dt, fallback = DEFAULT_FRAME_DT, max = MAX_STABLE_DT) {
  return Number.isFinite(dt) && dt > 0 ? Math.min(dt, max) : fallback
}

// ─── Exponential Damping ────────────────────────────────────────────────────
// θ_next = θ_current + (θ_target − θ_current)(1 − e^(−λΔt))

/** Damping alpha: α = 1 − e^(−λΔt) */
export function dampAlpha(lambda, dt) {
  return 1.0 - Math.exp(-lambda * stableDelta(dt))
}

/** Scalar exponential damp */
export function damp(current, target, lambda, dt) {
  return current + (target - current) * dampAlpha(lambda, dt)
}

/** Vector3 exponential damp (mutates `current`) */
export function dampVec3(current, target, lambda, dt) {
  const a = dampAlpha(lambda, dt)
  current.x += (target.x - current.x) * a
  current.y += (target.y - current.y) * a
  current.z += (target.z - current.z) * a
  return current
}

/** Color exponential damp (mutates `current`) */
export function dampColor(current, target, lambda, dt) {
  const a = dampAlpha(lambda, dt)
  current.r += (target.r - current.r) * a
  current.g += (target.g - current.g) * a
  current.b += (target.b - current.b) * a
  return current
}

// ─── Rodrigues Rotation ─────────────────────────────────────────────────────
// R_a(θ)v = v·cosθ + (a × v)·sinθ + a(a·v)(1 − cosθ)

/**
 * Rodrigues rotation of vector v around normalized axis a by angle θ (radians).
 * @param {THREE.Vector3} v - Vector to rotate
 * @param {THREE.Vector3} axis - Normalized rotation axis
 * @param {number} theta - Angle in radians
 * @returns {THREE.Vector3} Rotated vector (new)
 */
export function rodrigues(v, axis, theta) {
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const axv = new THREE.Vector3().crossVectors(axis, v)
  const adv = axis.dot(v)
  return new THREE.Vector3(
    v.x * cos + axv.x * sin + axis.x * adv * (1 - cos),
    v.y * cos + axv.y * sin + axis.y * adv * (1 - cos),
    v.z * cos + axv.z * sin + axis.z * adv * (1 - cos),
  )
}

/**
 * Computes the world-space transform for a hinge rotation.
 * p' = P + R_a(θ)(p − P)
 *
 * @param {THREE.Vector3} point - Point to rotate
 * @param {THREE.Vector3} pivot - Hinge pivot in world space
 * @param {THREE.Vector3} axis - Normalized hinge axis
 * @param {number} angle - Rotation angle in radians
 * @returns {THREE.Vector3} New point position
 */
export function hingePoint(point, pivot, axis, angle) {
  const offset = new THREE.Vector3().subVectors(point, pivot)
  const rotated = rodrigues(offset, axis, angle)
  return new THREE.Vector3().addVectors(pivot, rotated)
}

/**
 * Builds a Matrix4 for hinge rotation around a world-space pivot.
 * Usage: mesh.matrixAutoUpdate = false; mesh.matrix.copy(hingeMatrix(...))
 *
 * @param {THREE.Vector3} pivot - World pivot point
 * @param {THREE.Vector3} axis - Normalized axis
 * @param {number} angle - Radians
 * @param {THREE.Vector3} [originalPosition] - Mesh original world position
 * @param {THREE.Quaternion} [originalQuaternion] - Mesh original world quaternion
 * @param {THREE.Vector3} [originalScale] - Mesh original world scale
 * @returns {THREE.Matrix4}
 */
export function hingeMatrix(pivot, axis, angle, originalPosition, originalQuaternion, originalScale) {
  // T_pivot · R_axis(angle) · T_pivot_inv · Original
  const toPivot = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z)
  const rot = new THREE.Matrix4().makeRotationAxis(axis, angle)
  const fromPivot = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)

  const m = new THREE.Matrix4()
  if (originalPosition && originalQuaternion && originalScale) {
    m.compose(originalPosition, originalQuaternion, originalScale)
  }
  // result = fromPivot · rot · toPivot · original
  const hingeM = new THREE.Matrix4().multiplyMatrices(fromPivot, rot).multiply(toPivot)
  return hingeM.multiply(m)
}

// ─── Animation State Machine ────────────────────────────────────────────────

/**
 * Creates a smooth animation controller for a single float value.
 * Uses exponential damping per frame via update(dt).
 */
export class SmoothValue {
  constructor(initial = 0, lambda = 8) {
    this.current = initial
    this.target = initial
    this.lambda = lambda
    this._epsilon = 0.001
  }

  set(target) { this.target = target }
  snap(value) { this.current = value; this.target = value }
  get isSettled() { return Math.abs(this.current - this.target) < this._epsilon }

  update(dt) {
    if (this.isSettled) { this.current = this.target; return this.current }
    this.current = damp(this.current, this.target, this.lambda, stableDelta(dt))
    return this.current
  }
}

/**
 * Creates a smooth animation controller for a THREE.Color.
 */
export class SmoothColor {
  constructor(initial = '#ffffff', lambda = 8) {
    this.current = new THREE.Color(initial)
    this.target = new THREE.Color(initial)
    this.lambda = lambda
  }

  set(hex) { this.target.set(hex) }
  snap(hex) { this.current.set(hex); this.target.set(hex) }
  get isSettled() {
    return Math.abs(this.current.r - this.target.r) < 0.002
      && Math.abs(this.current.g - this.target.g) < 0.002
      && Math.abs(this.current.b - this.target.b) < 0.002
  }

  update(dt) {
    if (this.isSettled) { this.current.copy(this.target); return this.current }
    dampColor(this.current, this.target, this.lambda, stableDelta(dt))
    return this.current
  }
}

// ─── Blink ──────────────────────────────────────────────────────────────────

/** Hard blink: I(t) = Imax · step(0.5, sin(2πft)) */
export function blinkHard(time, frequency = 1.5, maxIntensity = 4.5) {
  return Math.sin(2 * Math.PI * frequency * time) > 0 ? maxIntensity : 0
}

/** Smooth blink: I(t) = Imax · (1 + sin(2πft)) / 2 */
export function blinkSmooth(time, frequency = 1.5, maxIntensity = 4.5) {
  return maxIntensity * (1 + Math.sin(2 * Math.PI * frequency * time)) / 2
}
