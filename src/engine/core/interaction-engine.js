/**
 * @module engine/core/interaction-engine
 * Per-frame interaction state machine for part entries.
 */

import * as THREE from 'three'
import { damp, SmoothColor, blinkHard, blinkSmooth, stableDelta } from '../math/animation.js'

const scratchOffset = new THREE.Vector3()
const scratchWorldPos = new THREE.Vector3()
const scratchQuat = new THREE.Quaternion()
const scratchColor = new THREE.Color()

function getAnimatedObjects(part) {
  return part.controlObjects?.length ? part.controlObjects : part.meshObjects
}

function applyWorldTransform(object, worldPosition, worldQuaternion) {
  if (object.parent) {
    object.parent.updateWorldMatrix(true, false)
    object.position.copy(object.parent.worldToLocal(worldPosition.clone()))

    const parentWQ = new THREE.Quaternion()
    object.parent.getWorldQuaternion(parentWQ)
    object.quaternion.multiplyQuaternions(parentWQ.invert(), worldQuaternion)
  } else {
    object.position.copy(worldPosition)
    object.quaternion.copy(worldQuaternion)
  }
}

export function updateHinge(part, dt) {
  dt = stableDelta(dt)
  const objects = getAnimatedObjects(part)
  if (!part.pivot || !part.axis || objects.length === 0) return

  const targetAngle = part.targetState === 'open' ? part.openAngle : part.closeAngle
  part._currentAngle = damp(part._currentAngle ?? part.closeAngle, targetAngle, part.lambda, dt)

  const q = scratchQuat.setFromAxisAngle(part.axis, part._currentAngle)

  for (let i = 0; i < objects.length; i++) {
    const object = objects[i]
    const origWP = part._originalWorldPositions?.[i]
    const origWQ = part._originalWorldQuaternions?.[i]
    if (!origWP || !origWQ) continue

    scratchOffset.subVectors(origWP, part.pivot).applyQuaternion(q)
    scratchWorldPos.copy(part.pivot).add(scratchOffset)
    const newWorldQuat = new THREE.Quaternion().multiplyQuaternions(q, origWQ)
    applyWorldTransform(object, scratchWorldPos, newWorldQuat)
  }
}

export function updateToggle(part, dt) {
  dt = stableDelta(dt)
  if (part.meshObjects.length === 0) return

  const matConfig = part.material
  const isOn = part.targetState === 'on'
  const targetIntensity = isOn ? (matConfig?.on?.emissiveIntensity ?? 4.5) : 0
  const targetColor = isOn ? (matConfig?.on?.emissiveColor ?? '#fff4cc') : '#000000'
  part._emissiveIntensity = damp(part._emissiveIntensity ?? 0, targetIntensity, part.lambda, dt)
  scratchColor.set(targetColor)
  const alpha = 1 - Math.exp(-part.lambda * dt)

  for (const mesh of part.meshObjects) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (mat.emissive !== undefined) {
        mat.emissive.lerp(scratchColor, alpha)
        mat.emissiveIntensity = part._emissiveIntensity
        mat.needsUpdate = false
      }
    }
  }
}

export function updateBlink(part, time) {
  if (part.targetState !== 'on' || part.meshObjects.length === 0) {
    for (const mesh of part.meshObjects) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of mats) if (mat.emissive) mat.emissiveIntensity = 0
    }
    return
  }

  const freq = part.material?.blinkFrequency ?? 1.5
  const maxI = part.material?.on?.emissiveIntensity ?? 4.5
  const mode = part.material?.blinkMode ?? 'hard'
  const intensity = mode === 'smooth' ? blinkSmooth(time, freq, maxI) : blinkHard(time, freq, maxI)

  for (const mesh of part.meshObjects) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) if (mat.emissive !== undefined) mat.emissiveIntensity = intensity
  }
}

export function updateColorChange(part, targetColor, dt) {
  dt = stableDelta(dt)
  if (!targetColor || part.meshObjects.length === 0) return

  part._colorSmoother = part._colorSmoother ?? new SmoothColor(targetColor, part.lambda)
  part._colorSmoother.set(targetColor)
  const color = part._colorSmoother.update(dt)

  for (const mesh of part.meshObjects) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (mat.color) mat.color.copy(color)
    }
  }
}

export function updateSpin(part, dt, speed = 0) {
  dt = stableDelta(dt)
  const objects = getAnimatedObjects(part)
  const axis = part.spinAxis || part.axis
  if (!axis || objects.length === 0 || speed === 0) return

  part._spinAngle = (part._spinAngle ?? 0) + speed * dt
  const q = scratchQuat.setFromAxisAngle(axis, part._spinAngle)

  for (let i = 0; i < objects.length; i++) {
    const object = objects[i]
    const origWP = part._originalWorldPositions?.[i]
    const origWQ = part._originalWorldQuaternions?.[i]
    if (!origWP || !origWQ) continue

    const pivot = part.pivot || part.origin || origWP
    scratchOffset.subVectors(origWP, pivot).applyQuaternion(q)
    scratchWorldPos.copy(pivot).add(scratchOffset)
    const newWorldQuat = new THREE.Quaternion().multiplyQuaternions(q, origWQ)
    applyWorldTransform(object, scratchWorldPos, newWorldQuat)
  }
}

export function updateTint(part, targetOpacity, dt) {
  dt = stableDelta(dt)
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

export class InteractionEngine {
  constructor() {
    this._commands = new Map()
    this._activeVariants = new Map()
    this._animating = new Set()
  }

  open(partId) { this._commands.set(partId, { type: 'setState', payload: 'open' }) }
  close(partId) { this._commands.set(partId, { type: 'setState', payload: 'closed' }) }
  toggle(partId) { this._commands.set(partId, { type: 'toggle', payload: null }) }
  setColor(partId, hex) { this._commands.set(partId, { type: 'color', payload: hex }) }
  setState(partId, state) { this._commands.set(partId, { type: 'setState', payload: state }) }
  setSpin(partId, speed) { this._commands.set(partId, { type: 'spin', payload: speed }) }

  update(registry, dt, time) {
    dt = stableDelta(dt)
    for (const [partId, cmd] of this._commands) {
      const part = registry.get(partId)
      if (!part) continue
      this._applyCommand(part, cmd)
    }
    this._commands.clear()

    for (const part of registry.all) {
      this._updatePart(part, dt, time)
    }
  }

  _applyCommand(part, cmd) {
    if (cmd.type === 'setState') {
      part.targetState = cmd.payload
    } else if (cmd.type === 'toggle') {
      if (part.interactions?.[0] === 'spin') {
        const isOn = part.targetState === 'on' || (part._spinSpeed ?? 0) !== 0
        part.targetState = isOn ? 'off' : 'on'
        part._spinSpeed = isOn ? 0 : (part.spinSpeed ?? 5.5)
        return
      }
      const toggleMap = { open: 'closed', closed: 'open', on: 'off', off: 'on', default: 'default' }
      part.targetState = toggleMap[part.currentState] ?? part.currentState
    } else if (cmd.type === 'color') {
      part._pendingColor = cmd.payload
    } else if (cmd.type === 'spin') {
      part._spinSpeed = cmd.payload
      part.targetState = cmd.payload ? 'on' : 'off'
    }
  }

  _ensureOriginalTransforms(part) {
    const animatedObjects = getAnimatedObjects(part)
    if (part._originalWorldPositions || animatedObjects.length === 0) return

    animatedObjects.forEach((object) => object.updateWorldMatrix(true, true))
    part._originalWorldPositions = animatedObjects.map((object) => {
      const wp = new THREE.Vector3()
      object.getWorldPosition(wp)
      return wp.clone()
    })
    part._originalWorldQuaternions = animatedObjects.map((object) => {
      const wq = new THREE.Quaternion()
      object.getWorldQuaternion(wq)
      return wq.clone()
    })
    part._currentAngle = part.closeAngle
  }

  _updatePart(part, dt, time) {
    const interaction = part.interactions[0]
    this._ensureOriginalTransforms(part)

    switch (interaction) {
      case 'hinge_open_close':
      case 'fold':
      case 'extend':
      case 'slide':
        updateHinge(part, dt)
        break
      case 'toggle':
        updateToggle(part, dt)
        break
      case 'blink':
        updateBlink(part, time)
        break
      case 'color_change':
        if (part._pendingColor) updateColorChange(part, part._pendingColor, dt)
        break
      case 'spin':
        updateSpin(part, dt, part._spinSpeed ?? (part.targetState === 'on' ? part.spinSpeed ?? 5.5 : 0))
        break
      case 'tint':
        if (part._pendingOpacity !== undefined) updateTint(part, part._pendingOpacity, dt)
        break
      default:
        break
    }

    const settled = interaction === 'spin'
      ? true
      : part._currentAngle !== undefined
        ? Math.abs(part._currentAngle - (part.targetState === 'open' ? part.openAngle : part.closeAngle)) < 0.002
        : true

    if (settled) part.currentState = part.targetState
  }
}
