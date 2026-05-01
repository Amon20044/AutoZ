/**
 * @module engine/core/interaction-engine
 * Config-driven interaction state machine.
 *
 * Handles per-part interactions each frame:
 *   - hinge_open_close  → pivot-based Rodrigues rotation w/ exp damping
 *   - toggle            → emissive intensity lerp
 *   - blink             → hard/smooth blink formula
 *   - color_change      → Color lerp
 *   - spin              → continuous rotation
 *   - fold              → mirror fold (same as hinge with own defaults)
 *   - extend            → spoiler extend (same as hinge)
 *   - tint              → opacity/transmission change
 *   - none              → no runtime effect
 */

import * as THREE from 'three'
import { damp, SmoothValue, SmoothColor, blinkHard, blinkSmooth } from '../math/animation.js'

// ─── Interaction Handlers ────────────────────────────────────────────────────

/**
 * Hinge open/close — Rodrigues pivot rotation with exponential damping.
 * Applies to: doors, bonnet, trunk, caps, mirrors, spoiler.
 *
 * @param {import('./part-registry.js').PartEntry} part
 * @param {number} dt - Frame delta time
 */
export function updateHinge(part, dt) {
  if (!part.pivot || !part.axis || part.meshObjects.length === 0) return

  const targetAngle = part.targetState === 'open' ? part.openAngle : part.closeAngle

  // Smooth current angle toward target
  part._currentAngle = damp(part._currentAngle ?? part.closeAngle, targetAngle, part.lambda, dt)

  // Build rotation quaternion around hinge axis
  const q = new THREE.Quaternion().setFromAxisAngle(part.axis, part._currentAngle)

  // Apply to each mesh: translate to pivot, rotate, translate back
  for (let i = 0; i < part.meshObjects.length; i++) {
    const mesh = part.meshObjects[i]
    const orig = part._originalWorldPositions?.[i]
    if (!orig) continue

    // p' = P + R_a(θ)(p - P)
    const offset = new THREE.Vector3().subVectors(orig, part.pivot)
    const rotated = offset.applyQuaternion(q)
    mesh.position.copy(part.pivot).add(rotated)

    // Also rotate the mesh's own orientation
    const origQ = part._originalWorldQuaternions?.[i]
    if (origQ) mesh.quaternion.multiplyQuaternions(q, origQ)
  }
}

/**
 * Emissive light toggle (headlights, taillights, DRLs).
 * @param {import('./part-registry.js').PartEntry} part
 * @param {number} dt
 * @param {number} time - Elapsed time for blink
 */
export function updateToggle(part, dt, time = 0) {
  if (part.meshObjects.length === 0) return

  const matConfig = part.material
  const isOn = part.targetState === 'on'
  const targetIntensity = isOn ? (matConfig?.on?.emissiveIntensity ?? 4.5) : 0
  const targetColor = isOn ? (matConfig?.on?.emissiveColor ?? '#fff4cc') : '#000000'

  part._emissiveIntensity = damp(part._emissiveIntensity ?? 0, targetIntensity, part.lambda, dt)

  for (const mesh of part.meshObjects) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (mat.emissive !== undefined) {
        mat.emissive.lerp(new THREE.Color(targetColor), 1 - Math.exp(-part.lambda * dt))
        mat.emissiveIntensity = part._emissiveIntensity
        mat.needsUpdate = false // intensity change doesn't need full recompile
      }
    }
  }
}

/**
 * Blink interaction (indicators).
 * @param {import('./part-registry.js').PartEntry} part
 * @param {number} time - Elapsed scene time
 */
export function updateBlink(part, time) {
  if (part.targetState !== 'on' || part.meshObjects.length === 0) {
    // Off — kill emissive
    for (const mesh of part.meshObjects) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of mats) { if (mat.emissive) mat.emissiveIntensity = 0 }
    }
    return
  }

  const freq = part.material?.blinkFrequency ?? 1.5
  const maxI = part.material?.on?.emissiveIntensity ?? 4.5
  const mode = part.material?.blinkMode ?? 'hard'
  const intensity = mode === 'smooth' ? blinkSmooth(time, freq, maxI) : blinkHard(time, freq, maxI)

  for (const mesh of part.meshObjects) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) { if (mat.emissive !== undefined) mat.emissiveIntensity = intensity }
  }
}

/**
 * Body color change — lerps baseColor on MeshStandardMaterial.
 * @param {import('./part-registry.js').PartEntry} part
 * @param {string} targetColor - Hex color string
 * @param {number} dt
 */
export function updateColorChange(part, targetColor, dt) {
  if (!targetColor || part.meshObjects.length === 0) return

  part._colorSmoother = part._colorSmoother ?? new SmoothColor(targetColor, part.lambda)
  part._colorSmoother.set(targetColor)
  const c = part._colorSmoother.update(dt)

  for (const mesh of part.meshObjects) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (mat.color) mat.color.copy(c)
    }
  }
}

/**
 * Wheel spin — continuous rotation on the wheel axis.
 * @param {import('./part-registry.js').PartEntry} part
 * @param {number} dt
 * @param {number} speed - rad/s, positive = forward
 */
export function updateSpin(part, dt, speed = 0) {
  if (!part.axis || part.meshObjects.length === 0) return
  const dAngle = speed * dt
  for (const mesh of part.meshObjects) {
    if (part.axis.x > 0.5) mesh.rotation.x += dAngle
    else if (part.axis.y > 0.5) mesh.rotation.y += dAngle
    else mesh.rotation.z += dAngle
  }
}

/**
 * Tint — opacity / transmission update for glass.
 * @param {import('./part-registry.js').PartEntry} part
 * @param {number} targetOpacity
 * @param {number} dt
 */
export function updateTint(part, targetOpacity, dt) {
  if (part.meshObjects.length === 0) return
  part._opacity = damp(part._opacity ?? 0.45, targetOpacity, part.lambda, dt)
  for (const mesh of part.meshObjects) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      mat.opacity = part._opacity
      mat.transparent = part._opacity < 1
    }
  }
}

// ─── Interaction Engine ──────────────────────────────────────────────────────

/**
 * The central per-frame update engine.
 * Call update(registry, dt, time) from your useFrame loop.
 */
export class InteractionEngine {
  constructor() {
    /** @type {Map<string, { type: string, payload: any }>} partId → pending command */
    this._commands = new Map()
    /** @type {Map<string, string>} partId → active variant/color */
    this._activeVariants = new Map()
    /** @type {Set<string>} partId → currently animating */
    this._animating = new Set()
  }

  // ─── Commands ─────────────────────────────────────────────────────────────

  /** Open a hinge part */
  open(partId) { this._commands.set(partId, { type: 'setState', payload: 'open' }) }
  /** Close a hinge part */
  close(partId) { this._commands.set(partId, { type: 'setState', payload: 'closed' }) }
  /** Toggle open/closed or on/off */
  toggle(partId) { this._commands.set(partId, { type: 'toggle', payload: null }) }
  /** Set a specific color variant */
  setColor(partId, hex) { this._commands.set(partId, { type: 'color', payload: hex }) }
  /** Set arbitrary state */
  setState(partId, state) { this._commands.set(partId, { type: 'setState', payload: state }) }
  /** Set wheel spin speed (rad/s) */
  setSpin(partId, speed) { this._commands.set(partId, { type: 'spin', payload: speed }) }

  // ─── Per-Frame Update ─────────────────────────────────────────────────────

  /**
   * @param {import('./part-registry.js').PartRegistry} registry
   * @param {number} dt - Frame delta time (seconds)
   * @param {number} time - Elapsed time (seconds)
   */
  update(registry, dt, time) {
    // 1. Apply pending commands
    for (const [partId, cmd] of this._commands) {
      const part = registry.get(partId)
      if (!part) continue
      this._applyCommand(part, cmd)
    }
    this._commands.clear()

    // 2. Run per-part animation
    for (const part of registry.all) {
      this._updatePart(part, dt, time)
    }
  }

  _applyCommand(part, cmd) {
    if (cmd.type === 'setState') {
      part.targetState = cmd.payload
    } else if (cmd.type === 'toggle') {
      const toggleMap = { open: 'closed', closed: 'open', on: 'off', off: 'on', default: 'default' }
      part.targetState = toggleMap[part.currentState] ?? part.currentState
    } else if (cmd.type === 'color') {
      part._pendingColor = cmd.payload
    } else if (cmd.type === 'spin') {
      part._spinSpeed = cmd.payload
    }
  }

  _updatePart(part, dt, time) {
    const interaction = part.interactions[0] // primary interaction

    // Store original world positions on first run (needed for hinge math)
    if (!part._originalWorldPositions && part.meshObjects.length > 0) {
      part._originalWorldPositions = part.meshObjects.map((m) => {
        const wp = new THREE.Vector3()
        m.getWorldPosition(wp)
        return wp.clone()
      })
      part._originalWorldQuaternions = part.meshObjects.map((m) => {
        const wq = new THREE.Quaternion()
        m.getWorldQuaternion(wq)
        return wq.clone()
      })
      part._currentAngle = part.closeAngle
    }

    switch (interaction) {
      case 'hinge_open_close':
      case 'fold':
      case 'extend':
      case 'slide':
        updateHinge(part, dt)
        break
      case 'toggle':
        updateToggle(part, dt, time)
        break
      case 'blink':
        updateBlink(part, time)
        break
      case 'color_change':
        if (part._pendingColor) updateColorChange(part, part._pendingColor, dt)
        break
      case 'spin':
        updateSpin(part, dt, part._spinSpeed ?? 0)
        break
      case 'tint':
        if (part._pendingOpacity !== undefined) updateTint(part, part._pendingOpacity, dt)
        break
      default:
        break
    }

    // Sync currentState when animation is settled
    const settled = part._currentAngle !== undefined
      ? Math.abs(part._currentAngle - (part.targetState === 'open' ? part.openAngle : part.closeAngle)) < 0.002
      : true
    if (settled) part.currentState = part.targetState
  }
}
