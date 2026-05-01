/**
 * @module engine/core/part-registry
 * Runtime registry for detected and configured vehicle parts.
 */

import * as THREE from 'three'
import { computePivotPresets } from '../math/normalization.js'
import { buildTaxonomyMap } from './part-taxonomy.js'

const taxonomyMap = buildTaxonomyMap()

function toVector3(value) {
  return Array.isArray(value) && value.length >= 3
    ? new THREE.Vector3(value[0], value[1], value[2])
    : null
}

function uniqueByUuid(items) {
  const map = new Map()
  for (const item of items) {
    const key = item?.uuid ?? item?.id
    if (key) map.set(key, item)
  }
  return [...map.values()]
}

function allTargets(targetIndex, meshIndex) {
  return targetIndex?.get?.('__all__') ?? meshIndex?.get?.('__targets__') ?? []
}

function findTargets(value, targetIndex, meshIndex) {
  if (!value) return []
  const direct = targetIndex?.get?.(value)
  if (direct?.length) return direct
  return allTargets(targetIndex, meshIndex).filter((target) => (
    target.name === value
    || target.rootName === value
    || target.nodePath === value
  ))
}

function resolveTargets(config, meshIndex, targetIndex) {
  const targets = []
  if (config.nodePath) targets.push(...findTargets(config.nodePath, targetIndex, meshIndex))
  if (config.rootName) targets.push(...findTargets(config.rootName, targetIndex, meshIndex))
  for (const name of (config.meshNames ?? [])) {
    targets.push(...findTargets(name, targetIndex, meshIndex))
  }
  return uniqueByUuid(targets)
}

function resolveMeshes(config, meshIndex) {
  const meshObjects = []
  for (const name of (config.meshNames || [])) {
    const matches = meshIndex.get(name)
    if (matches) {
      meshObjects.push(...matches)
      continue
    }

    for (const [key, value] of meshIndex) {
      if (key.startsWith('__')) continue
      if (key.toLowerCase().includes(name.toLowerCase())) {
        meshObjects.push(...value)
        break
      }
    }
  }
  return uniqueByUuid(meshObjects)
}

function distanceToBox(point, box) {
  const clamped = point.clone().clamp(box.min, box.max)
  return clamped.distanceTo(point)
}

function isUsableOrigin(origin, target) {
  if (!origin || !Number.isFinite(origin.x) || !target?.bbox) return false
  const maxSize = Math.max(target.size.x, target.size.y, target.size.z)
  const tolerance = Math.max(maxSize * 0.75, 0.25)
  return distanceToBox(origin, target.bbox) <= tolerance
}

function isOriginDefaultInteraction(interaction) {
  return interaction === 'hinge_open_close'
    || interaction === 'fold'
    || interaction === 'extend'
    || interaction === 'slide'
    || interaction === 'spin'
}

function autoSelectPivot(typeKey, presets) {
  const map = {
    'door.front.left':  presets.frontLeft,
    'door.front.right': presets.frontRight,
    'door.rear.left':   presets.frontLeft,
    'door.rear.right':  presets.frontRight,
    'bonnet.front':     presets.topRear,
    'bonnet.rear':      presets.topRear,
    'cap.fuel':         presets.rearLeft,
    'cap.charge':       presets.rearRight,
    'mirror.left':      presets.right,
    'mirror.right':     presets.left,
    'spoiler':          presets.rear,
  }
  return map[typeKey] ?? presets.center
}

function getDefaultState(interaction) {
  if (!interaction) return 'closed'
  if (interaction === 'toggle' || interaction === 'blink' || interaction === 'spin') return 'off'
  if (interaction === 'color_change') return 'default'
  return 'closed'
}

function resolveAnchor(config, primaryTarget, meshObjects) {
  const configured = toVector3(config.anchor)
  if (configured) return configured

  if (primaryTarget?.bbox) {
    const anchor = primaryTarget.bbox.getCenter(new THREE.Vector3())
    anchor.y = primaryTarget.bbox.max.y
    return anchor
  }

  if (meshObjects.length > 0) {
    const box = new THREE.Box3().setFromObject(meshObjects[0])
    const anchor = box.getCenter(new THREE.Vector3())
    anchor.y = box.max.y
    return anchor
  }

  return null
}

function resolvePivot(config, def, primaryTarget, meshObjects, interaction) {
  const configured = toVector3(config.pivot)
  if (configured) return { pivot: configured, pivotSource: 'config' }

  const origin = toVector3(config.origin) ?? primaryTarget?.origin?.clone?.() ?? null
  const preferOrigin = config.pivotSource === 'origin' || isOriginDefaultInteraction(interaction)
  if (preferOrigin && origin && (!primaryTarget || isUsableOrigin(origin, primaryTarget))) {
    return { pivot: origin, pivotSource: 'origin' }
  }

  if (config.pivotPreset && meshObjects.length > 0) {
    const presets = computePivotPresets(meshObjects[0])
    return { pivot: presets[config.pivotPreset] ?? presets.center, pivotSource: 'preset' }
  }

  if (meshObjects.length > 0 && def?.defaultAxis) {
    const presets = computePivotPresets(meshObjects[0])
    return { pivot: autoSelectPivot(config.typeKey, presets), pivotSource: 'bbox' }
  }

  return { pivot: null, pivotSource: null }
}

/**
 * Creates a PartEntry from a config block and resolved scene indexes.
 *
 * @param {object} config
 * @param {Map<string, THREE.Mesh[]>} meshIndex
 * @param {{ score?: number, method?: string }} [detection]
 * @param {Map<string, any[]> | null} [targetIndex]
 * @returns {PartEntry | null}
 */
export function createPartEntry(config, meshIndex, detection = {}, targetIndex = null) {
  const def = taxonomyMap.get(config.typeKey)
  if (!def && !config.typeKey) {
    console.warn('[PartRegistry] No typeKey for config:', config)
    return null
  }

  const targetEntries = resolveTargets(config, meshIndex, targetIndex)
  const primaryTarget = targetEntries[0] ?? null
  const targetMeshes = uniqueByUuid(targetEntries.flatMap((target) => target.meshes ?? []))
  const meshObjects = targetMeshes.length > 0 ? targetMeshes : resolveMeshes(config, meshIndex)

  if (meshObjects.length === 0 && (config.meshNames?.length > 0 || config.rootName || config.nodePath)) {
    console.warn(`[PartRegistry] No meshes resolved for part "${config.id}" (${config.typeKey})`)
  }

  const interaction = config.interactions?.[0] ?? def?.defaultInteraction
  const { pivot, pivotSource } = resolvePivot(config, def, primaryTarget, meshObjects, interaction)

  const axis = config.axis
    ? new THREE.Vector3(...config.axis).normalize()
    : def?.defaultAxis
      ? new THREE.Vector3(...def.defaultAxis).normalize()
      : null

  const spinAxis = config.spinAxis
    ? new THREE.Vector3(...config.spinAxis).normalize()
    : axis?.clone?.() ?? null

  const origin = toVector3(config.origin)
    ?? primaryTarget?.origin?.clone?.()
    ?? pivot?.clone?.()
    ?? null

  const openAngle = config.openAngle ?? def?.defaultOpenAngle ?? 0
  const closeAngle = config.closeAngle ?? 0
  const defaultState = config.defaultState ?? getDefaultState(interaction)
  const controlObjects = uniqueByUuid(targetEntries.map((target) => target.object).filter(Boolean))

  return {
    id: config.id || `part_${config.typeKey}_${Date.now()}`,
    typeKey: config.typeKey,
    label: config.label || def?.label || config.typeKey,
    category: def?.category || 'unknown',

    rootName: config.rootName || primaryTarget?.rootName || null,
    nodePath: config.nodePath || primaryTarget?.nodePath || null,
    meshNames: config.meshNames || (primaryTarget ? [primaryTarget.name] : []),
    meshObjects,
    controlObjects,

    origin,
    pivot,
    pivotSource: config.pivotSource || pivotSource,
    axis,
    spinAxis,
    anchor: resolveAnchor(config, primaryTarget, meshObjects),

    openAngle: THREE.MathUtils.degToRad(openAngle),
    closeAngle: THREE.MathUtils.degToRad(closeAngle),
    lambda: config.lambda ?? 8,
    spinSpeed: config.spinSpeed ?? 5.5,

    defaultState,
    currentState: defaultState,
    targetState: defaultState,

    interactions: config.interactions || [interaction],
    material: config.material || null,
    visibleInUI: config.visibleInUI ?? true,

    detection: { score: detection.score ?? 1.0, method: detection.method ?? 'manual' },

    _angle: new THREE.Vector3(0, 0, 0),
    _originalMatrices: meshObjects.map((m) => m.matrix.clone()),
  }
}

export class PartRegistry {
  constructor() {
    this._parts = new Map()
    this._byType = new Map()
    this._byCategory = new Map()
  }

  register(entry) {
    this._parts.set(entry.id, entry)

    if (!this._byType.has(entry.typeKey)) this._byType.set(entry.typeKey, new Set())
    this._byType.get(entry.typeKey).add(entry.id)

    if (!this._byCategory.has(entry.category)) this._byCategory.set(entry.category, new Set())
    this._byCategory.get(entry.category).add(entry.id)
  }

  get(id) { return this._parts.get(id) }

  getByType(typeKey) {
    const ids = this._byType.get(typeKey)
    if (!ids) return []
    return [...ids].map((id) => this._parts.get(id)).filter(Boolean)
  }

  getByCategory(category) {
    const ids = this._byCategory.get(category)
    if (!ids) return []
    return [...ids].map((id) => this._parts.get(id)).filter(Boolean)
  }

  getByCategories(categories) {
    return categories.flatMap((category) => this.getByCategory(category))
  }

  get all() { return [...this._parts.values()] }
  get interactive() { return this.all.filter((p) => p.visibleInUI) }
  get lights() { return this.getByCategory('light') }
  get wheelSpinParts() { return this.getByCategories(['wheel', 'rim']) }
  get frameInteractive() {
    return this.interactive.filter((p) => !['light', 'wheel', 'rim'].includes(p.category))
  }

  clear() {
    this._parts.clear()
    this._byType.clear()
    this._byCategory.clear()
  }

  serialize() {
    return this.all.map((p) => ({
      id: p.id,
      typeKey: p.typeKey,
      label: p.label,
      rootName: p.rootName,
      nodePath: p.nodePath,
      meshNames: p.meshNames,
      origin: p.origin?.toArray() ?? null,
      pivot: p.pivot?.toArray() ?? null,
      pivotSource: p.pivotSource,
      axis: p.axis?.toArray() ?? null,
      spinAxis: p.spinAxis?.toArray() ?? null,
      anchor: p.anchor?.toArray() ?? null,
      openAngle: THREE.MathUtils.radToDeg(p.openAngle),
      closeAngle: THREE.MathUtils.radToDeg(p.closeAngle),
      lambda: p.lambda,
      spinSpeed: p.spinSpeed,
      defaultState: p.defaultState,
      interactions: p.interactions,
      visibleInUI: p.visibleInUI,
      material: p.material,
    }))
  }
}

/**
 * @typedef {object} PartEntry
 * @property {string} id
 * @property {string} typeKey
 * @property {string} label
 * @property {string} category
 * @property {string|null} rootName
 * @property {string|null} nodePath
 * @property {string[]} meshNames
 * @property {THREE.Mesh[]} meshObjects
 * @property {THREE.Object3D[]} controlObjects
 * @property {THREE.Vector3|null} origin
 * @property {THREE.Vector3|null} pivot
 * @property {string|null} pivotSource
 * @property {THREE.Vector3|null} axis
 * @property {THREE.Vector3|null} spinAxis
 * @property {THREE.Vector3|null} anchor
 * @property {number} openAngle
 * @property {number} closeAngle
 * @property {number} lambda
 * @property {number} spinSpeed
 * @property {string} defaultState
 * @property {string} currentState
 * @property {string} targetState
 * @property {string[]} interactions
 * @property {object|null} material
 * @property {boolean} visibleInUI
 * @property {{ score: number, method: string }} detection
 */
