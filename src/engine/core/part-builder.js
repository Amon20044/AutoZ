/**
 * @module engine/core/part-builder
 * High-level assembler: builds a PartRegistry from a scene + config snapshot.
 *
 * Flow:
 *   1. Index meshes from loaded GLTF scene
 *   2. Run auto-detection if config has no parts (or partial)
 *   3. Merge detection results with explicit config overrides
 *   4. Create PartEntry for each resolved part
 *   5. Register all entries into a PartRegistry
 *
 * This is designed to be called once after GLTF load.
 */

import { indexMeshesByName, computeMeshBounds, getSceneStats } from './mesh-traversal.js'
import { classifyScene } from './part-detector.js'
import { createPartEntry, PartRegistry } from './part-registry.js'

/**
 * Builds a complete PartRegistry from a Three.js scene and config.
 *
 * @param {THREE.Object3D} scene - The loaded GLTF scene root
 * @param {object} config - Snapshot or draft config
 * @param {object[]} [config.parts] - User-defined part configs
 * @param {number} [options.threshold=0.45] - Auto-detection confidence threshold
 * @param {boolean} [options.autoDetect=true] - Run auto-detection for unlisted meshes
 * @param {boolean} [options.verbose=false] - Log detection results
 * @returns {{ registry: PartRegistry, meshIndex: Map, stats: object, report: BuildReport }}
 */
export function buildPartRegistry(scene, config = {}, options = {}) {
  const { threshold = 0.45, autoDetect = true, verbose = false } = options

  // 1. Index
  const meshIndex = indexMeshesByName(scene)
  const meshBounds = computeMeshBounds(scene)
  const sceneStats = getSceneStats(scene)
  const registry = new PartRegistry()

  const report = {
    totalMeshes: sceneStats.meshCount,
    autoDetected: [],
    manualParts: [],
    unmatched: [],
    errors: [],
  }

  // 2. Manual parts from config (highest priority — always register these)
  const manualMeshNames = new Set()
  for (const partConfig of (config.parts ?? [])) {
    try {
      const entry = createPartEntry(partConfig, meshIndex)
      if (entry) {
        registry.register(entry)
        report.manualParts.push({ id: entry.id, typeKey: entry.typeKey, meshNames: entry.meshNames })
        for (const n of entry.meshNames) manualMeshNames.add(n)
      }
    } catch (err) {
      report.errors.push({ partConfig, error: err.message })
      if (verbose) console.error('[PartBuilder] Error creating part:', partConfig, err)
    }
  }

  // 3. Auto-detect remaining meshes
  if (autoDetect) {
    // Exclude meshes already claimed by manual parts
    const candidateIndex = new Map()
    for (const [name, meshes] of meshIndex) {
      if (name === '__all__' || manualMeshNames.has(name)) continue
      candidateIndex.set(name, meshes)
    }

    const { detections, unmatched } = classifyScene(candidateIndex, threshold)
    report.unmatched = unmatched

    for (const det of detections) {
      // Skip if this typeKey already has a manual part (avoid duplicates)
      const existing = registry.getByType(det.typeKey)
      if (existing.length > 0) {
        if (verbose) console.log(`[PartBuilder] Skip auto-detect "${det.meshName}" → ${det.typeKey} (manual exists)`)
        continue
      }

      const autoConfig = {
        id: `auto_${det.typeKey.replace(/\./g, '_')}_${det.meshName}`,
        typeKey: det.typeKey,
        label: det.label,
        meshNames: [det.meshName],
        defaultState: det.defaultInteraction === 'toggle' || det.defaultInteraction === 'blink' ? 'off' : 'closed',
        interactions: [det.defaultInteraction],
        visibleInUI: det.score >= 0.6, // Only show high-confidence as UI
      }
      if (det.defaultAxis) autoConfig.axis = det.defaultAxis
      if (det.defaultOpenAngle) autoConfig.openAngle = det.defaultOpenAngle

      try {
        const entry = createPartEntry(autoConfig, meshIndex, { score: det.score, method: det.method })
        if (entry) {
          registry.register(entry)
          report.autoDetected.push({
            meshName: det.meshName, typeKey: det.typeKey, score: Math.round(det.score * 100) + '%',
            method: det.method, alternates: det.alternates?.map(a => `${a.typeKey}(${Math.round(a.score*100)}%)`)
          })
        }
      } catch (err) {
        report.errors.push({ autoConfig, error: err.message })
      }
    }
  }

  if (verbose) {
    console.group('[AutoZ PartBuilder] Build Report')
    console.log('Scene stats:', sceneStats)
    console.log('Manual parts:', report.manualParts)
    console.log('Auto-detected:', report.autoDetected)
    console.log('Unmatched meshes:', report.unmatched)
    if (report.errors.length) console.error('Errors:', report.errors)
    console.groupEnd()
  }

  return { registry, meshIndex, meshBounds, stats: sceneStats, report }
}

/**
 * Rebuilds the registry from an updated config (e.g. editor saves).
 * Clears and re-populates without reloading the scene.
 *
 * @param {import('./part-registry.js').PartRegistry} registry - Existing registry
 * @param {Map} meshIndex - From original buildPartRegistry call
 * @param {object[]} parts - Updated parts config
 */
export function rebuildParts(registry, meshIndex, parts) {
  registry.clear()
  for (const partConfig of parts) {
    const entry = createPartEntry(partConfig, meshIndex)
    if (entry) registry.register(entry)
  }
}

/**
 * @typedef {object} BuildReport
 * @property {number} totalMeshes
 * @property {object[]} autoDetected
 * @property {object[]} manualParts
 * @property {string[]} unmatched
 * @property {object[]} errors
 */
