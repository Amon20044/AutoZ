/**
 * @module engine/core/part-registry
 * Config-driven part registry.
 *
 * The registry is the bridge between:
 *   - Raw auto-detected parts (from part-detector)
 *   - User-defined config JSON (from the editor / snapshot)
 *   - The live Three.js scene (mesh references)
 *
 * A PartEntry is the canonical runtime object for one tagged part:
 * {
 *   id, typeKey, label, category,
 *   meshNames, meshObjects,         ← actual THREE.Mesh references
 *   pivot, axis, anchor,            ← hinge config
 *   defaultState, currentState,
 *   interactions[],                 ← interaction IDs
 *   material,                       ← material override config
 *   visibleInUI,
 *   detection: { score, method }    ← how it was found
 * }
 */

import * as THREE from 'three'
import { computePivotPresets } from '../math/normalization.js'
import { buildTaxonomyMap } from './part-taxonomy.js'

const taxonomyMap = buildTaxonomyMap()

// ─── Part Entry Factory ──────────────────────────────────────────────────────

/**
 * Creates a PartEntry from a user config block + resolved mesh objects.
 *
 * Config shape (from editor/snapshot):
 * {
 *   id: string,
 *   typeKey: string,                       // e.g. "door.front.left"
 *   label?: string,
 *   meshNames: string[],                   // mesh names to control
 *   pivot?: [x,y,z],                       // hinge pivot in world space
 *   pivotPreset?: 'left'|'right'|'front'|'rear'|'top'|'bottom'|'center',
 *   axis?: [x,y,z],                        // hinge rotation axis
 *   anchor?: [x,y,z],                      // where radial UI appears
 *   defaultState?: 'open'|'closed'|'on'|'off',
 *   openAngle?: number,                    // degrees
 *   closeAngle?: number,
 *   lambda?: number,                       // damping speed
 *   interactions?: string[],
 *   visibleInUI?: boolean,
 *   material?: object,                     // material override
 * }
 *
 * @param {object} config - User config block
 * @param {Map<string, THREE.Mesh[]>} meshIndex - From indexMeshesByName()
 * @param {{ score?: number, method?: string }} [detection] - From part-detector
 * @returns {PartEntry | null}
 */
export function createPartEntry(config, meshIndex, detection = {}) {
  const def = taxonomyMap.get(config.typeKey)
  if (!def && !config.typeKey) {
    console.warn('[PartRegistry] No typeKey for config:', config)
    return null
  }

  // Resolve mesh objects
  const meshObjects = []
  for (const name of (config.meshNames || [])) {
    const matches = meshIndex.get(name)
    if (matches) meshObjects.push(...matches)
    else {
      // Fallback: partial match
      for (const [k, v] of meshIndex) {
        if (k !== '__all__' && k.toLowerCase().includes(name.toLowerCase())) {
          meshObjects.push(...v)
          break
        }
      }
    }
  }

  if (meshObjects.length === 0 && (config.meshNames?.length > 0)) {
    console.warn(`[PartRegistry] No meshes resolved for part "${config.id}" (${config.typeKey})`)
  }

  // Pivot resolution
  let pivot = null
  if (config.pivot) {
    pivot = new THREE.Vector3(...config.pivot)
  } else if (config.pivotPreset && meshObjects.length > 0) {
    const presets = computePivotPresets(meshObjects[0])
    pivot = presets[config.pivotPreset] ?? presets.center
  } else if (meshObjects.length > 0 && def?.defaultAxis) {
    // Auto-compute pivot from preset based on part type
    const presets = computePivotPresets(meshObjects[0])
    pivot = autoSelectPivot(config.typeKey, presets)
  }

  // Axis resolution
  const axis = config.axis
    ? new THREE.Vector3(...config.axis).normalize()
    : def?.defaultAxis
      ? new THREE.Vector3(...def.defaultAxis).normalize()
      : null

  // Anchor (where radial UI appears)
  let anchor = null
  if (config.anchor) {
    anchor = new THREE.Vector3(...config.anchor)
  } else if (meshObjects.length > 0) {
    const box = new THREE.Box3().setFromObject(meshObjects[0])
    anchor = box.getCenter(new THREE.Vector3())
    anchor.y = box.max.y // top of mesh for UI
  }

  const openAngle = config.openAngle ?? def?.defaultOpenAngle ?? 0
  const closeAngle = config.closeAngle ?? 0
  const defaultState = config.defaultState ?? getDefaultState(def?.defaultInteraction)

  return {
    id: config.id || `part_${config.typeKey}_${Date.now()}`,
    typeKey: config.typeKey,
    label: config.label || def?.label || config.typeKey,
    category: def?.category || 'unknown',

    meshNames: config.meshNames || [],
    meshObjects,

    pivot,
    axis,
    anchor,

    openAngle: THREE.MathUtils.degToRad(openAngle),
    closeAngle: THREE.MathUtils.degToRad(closeAngle),
    lambda: config.lambda ?? 8,

    defaultState,
    currentState: defaultState,
    targetState: defaultState,

    interactions: config.interactions || [config.typeKey],
    material: config.material || null,
    visibleInUI: config.visibleInUI ?? true,

    detection: { score: detection.score ?? 1.0, method: detection.method ?? 'manual' },

    // Runtime animation state (mutated per frame)
    _angle: new THREE.Vector3(0, 0, 0),
    _originalMatrices: meshObjects.map((m) => m.matrix.clone()),
  }
}

/**
 * Auto-selects pivot preset based on part type.
 * @param {string} typeKey
 * @param {Record<string, THREE.Vector3>} presets
 * @returns {THREE.Vector3}
 */
function autoSelectPivot(typeKey, presets) {
  const map = {
    'door.front.left':  presets.front,    // hinges at front vertical edge
    'door.front.right': presets.front,
    'door.rear.left':   presets.rear,     // suicide door hinges at rear
    'door.rear.right':  presets.rear,
    'bonnet.front':     presets.rear,     // hood hinges at rear edge
    'bonnet.rear':      presets.topRear,  // trunk hinges at top-rear
    'cap.fuel':         presets.rearLeft,
    'cap.charge':       presets.rearRight,
    'mirror.left':      presets.right,
    'mirror.right':     presets.left,
    'spoiler':          presets.front,
  }
  return map[typeKey] ?? presets.center
}

function getDefaultState(interaction) {
  if (!interaction) return 'closed'
  if (interaction === 'toggle') return 'off'
  if (interaction === 'blink') return 'off'
  if (interaction === 'color_change') return 'default'
  return 'closed'
}

// ─── Part Registry ───────────────────────────────────────────────────────────

/**
 * Runtime part registry — stores all PartEntries for a loaded scene.
 */
export class PartRegistry {
  constructor() {
    /** @type {Map<string, PartEntry>} id → PartEntry */
    this._parts = new Map()
    /** @type {Map<string, Set<string>>} typeKey → Set<id> */
    this._byType = new Map()
    /** @type {Map<string, Set<string>>} category → Set<id> */
    this._byCategory = new Map()
  }

  /** Register a PartEntry */
  register(entry) {
    this._parts.set(entry.id, entry)

    if (!this._byType.has(entry.typeKey)) this._byType.set(entry.typeKey, new Set())
    this._byType.get(entry.typeKey).add(entry.id)

    if (!this._byCategory.has(entry.category)) this._byCategory.set(entry.category, new Set())
    this._byCategory.get(entry.category).add(entry.id)
  }

  /** @param {string} id @returns {PartEntry|undefined} */
  get(id) { return this._parts.get(id) }

  /** @param {string} typeKey @returns {PartEntry[]} */
  getByType(typeKey) {
    const ids = this._byType.get(typeKey)
    if (!ids) return []
    return [...ids].map((id) => this._parts.get(id)).filter(Boolean)
  }

  /** @param {string} category @returns {PartEntry[]} */
  getByCategory(category) {
    const ids = this._byCategory.get(category)
    if (!ids) return []
    return [...ids].map((id) => this._parts.get(id)).filter(Boolean)
  }

  /** All registered parts */
  get all() { return [...this._parts.values()] }

  /** All parts with visibleInUI=true */
  get interactive() { return this.all.filter((p) => p.visibleInUI) }

  /** Clear registry */
  clear() { this._parts.clear(); this._byType.clear(); this._byCategory.clear() }

  /**
   * Serialize the registry to a snapshot-compatible array.
   * @returns {object[]}
   */
  serialize() {
    return this.all.map((p) => ({
      id: p.id,
      typeKey: p.typeKey,
      label: p.label,
      meshNames: p.meshNames,
      pivot: p.pivot?.toArray() ?? null,
      axis: p.axis?.toArray() ?? null,
      anchor: p.anchor?.toArray() ?? null,
      openAngle: THREE.MathUtils.radToDeg(p.openAngle),
      closeAngle: THREE.MathUtils.radToDeg(p.closeAngle),
      lambda: p.lambda,
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
 * @property {string[]} meshNames
 * @property {THREE.Mesh[]} meshObjects
 * @property {THREE.Vector3|null} pivot
 * @property {THREE.Vector3|null} axis
 * @property {THREE.Vector3|null} anchor
 * @property {number} openAngle - radians
 * @property {number} closeAngle - radians
 * @property {number} lambda - damping speed
 * @property {string} defaultState
 * @property {string} currentState
 * @property {string} targetState
 * @property {string[]} interactions
 * @property {object|null} material
 * @property {boolean} visibleInUI
 * @property {{ score: number, method: string }} detection
 */
