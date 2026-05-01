/**
 * @module engine/core/part-builder
 * Builds a PartRegistry from a loaded scene plus optional saved config.
 */

import * as THREE from 'three'
import {
  indexMeshesByName,
  buildPartTargetIndex,
  mergeTargetMeshesIntoIndex,
  computeMeshBounds,
  getSceneStats,
} from './mesh-traversal.js'
import { classifyMesh, tokenize } from './part-detector.js'
import { createPartEntry, PartRegistry } from './part-registry.js'
import { buildTaxonomyMap } from './part-taxonomy.js'

const _taxonomyMap = buildTaxonomyMap()

function reassignDetection(det, newTypeKey) {
  if (det.typeKey === newTypeKey) return
  const def = _taxonomyMap.get(newTypeKey)
  if (!def) return
  det.typeKey = newTypeKey
  det.label = def.label
  det.category = def.category
  det.defaultInteraction = def.defaultInteraction
  det.defaultAxis = def.defaultAxis
  det.defaultOpenAngle = def.defaultOpenAngle
  det._spatiallyConfirmed = true
}

function spatiallyDisambiguate(detections, targets) {
  if (targets.length === 0) return

  const carBox = new THREE.Box3()
  for (const target of targets) {
    for (const mesh of target.meshes) {
      mesh.updateWorldMatrix(true, false)
      carBox.expandByObject(mesh)
    }
  }
  const carCenter = carBox.getCenter(new THREE.Vector3())

  const byCategory = new Map()
  for (const det of detections) {
    if (!byCategory.has(det.category)) byCategory.set(det.category, [])
    byCategory.get(det.category).push(det)
  }

  const positionalCategories = new Set(['door', 'wheel', 'rim', 'mirror', 'light'])

  for (const category of positionalCategories) {
    const dets = byCategory.get(category)
    if (!dets || dets.length <= 1) continue

    const typeKeys = dets.map(d => d.typeKey)
    const uniqueKeys = new Set(typeKeys)
    const needsSpatial = dets.some(d => d._requiresSpatial)
    if (!needsSpatial && uniqueKeys.size === dets.length) continue

    const withPositions = dets
      .map(det => det.target ? { det, center: det.target.center.clone() } : null)
      .filter(Boolean)

    if (category === 'mirror') {
      for (const { det, center } of withPositions) {
        reassignDetection(det, center.x < carCenter.x ? 'mirror.left' : 'mirror.right')
      }
      continue
    }

    for (const { det, center } of withPositions) {
      const isLeft = center.x < carCenter.x
      const isFront = center.z > carCenter.z
      let newKey = null

      if (category === 'door') {
        newKey = isFront
          ? (isLeft ? 'door.front.left' : 'door.front.right')
          : (isLeft ? 'door.rear.left' : 'door.rear.right')
      } else if (category === 'wheel') {
        newKey = isFront
          ? (isLeft ? 'wheel.front.left' : 'wheel.front.right')
          : (isLeft ? 'wheel.rear.left' : 'wheel.rear.right')
      } else if (category === 'rim') {
        newKey = isFront
          ? (isLeft ? 'rim.front.left' : 'rim.front.right')
          : (isLeft ? 'rim.rear.left' : 'rim.rear.right')
      } else if (category === 'light') {
        const isHead = det.typeKey.includes('.head.') || (needsSpatial && isFront)
        const prefix = isHead ? 'light.head.front' : 'light.tail.rear'
        newKey = `${prefix}.${isLeft ? 'left' : 'right'}`
      }

      if (newKey) reassignDetection(det, newKey)
    }
  }
}

function isGenericWheelLikeName(name) {
  const tokens = tokenize(name)
  if (tokens.length === 0) return false
  const wheelWords = new Set(['wheel', 'tire', 'tyre', 'rim', 'alloy', 'hubcap'])
  const sideWords = new Set(['front', 'rear', 'back', 'left', 'right', 'fl', 'fr', 'rl', 'rr', 'lf', 'rf', 'lr'])
  return tokens.some((token) => wheelWords.has(token))
    && !tokens.some((token) => sideWords.has(token))
}

function genericDetectionForTarget(target) {
  const tokens = tokenize(target.name)
  const isRim = tokens.some((token) => ['rim', 'alloy', 'hubcap'].includes(token))
  const typeKey = isRim ? 'rim.front.left' : 'wheel.front.left'
  const def = _taxonomyMap.get(typeKey)
  if (!def) return null
  return {
    meshName: target.name,
    targetId: target.id,
    target,
    typeKey,
    label: def.label,
    category: def.category,
    score: 0.52,
    method: 'generic_spatial',
    breakdown: { exact: 0, regex: 0, fuzzy: 0, jaccard: 0, ngram: 0 },
    defaultInteraction: def.defaultInteraction,
    defaultAxis: def.defaultAxis,
    defaultOpenAngle: def.defaultOpenAngle,
    alternates: [],
    _requiresSpatial: true,
  }
}

function classifyTargets(targets, threshold) {
  const detections = []
  const unmatched = []

  for (const target of targets) {
    let det = classifyMesh(target.name, threshold)
    if (!det && isGenericWheelLikeName(target.name)) {
      det = genericDetectionForTarget(target)
    }

    if (!det) {
      unmatched.push(target.name)
      continue
    }

    detections.push({
      ...det,
      meshName: target.name,
      targetId: target.id,
      target,
      rootName: target.rootName,
      nodePath: target.nodePath,
    })
  }

  return { detections, unmatched }
}

function targetHasDetectedDescendant(det, detections) {
  const target = det.target
  if (!target) return false
  return detections.some((other) => (
    other !== det
    && other.target
    && other.category !== 'body'
    && other.target.nodePath.startsWith(`${target.nodePath} > `)
  ))
}

function detectionSortPriority(det) {
  const categoryOrder = {
    door: 0,
    mirror: 1,
    wheel: 2,
    rim: 3,
    light: 4,
    bonnet: 5,
    trunk: 5,
    cap: 6,
    body: 20,
  }
  return categoryOrder[det.category] ?? 10
}

function sortDetections(detections) {
  detections.sort((a, b) => {
    const scoreDelta = b.score - a.score
    if (Math.abs(scoreDelta) > 1e-6) return scoreDelta
    const categoryDelta = detectionSortPriority(a) - detectionSortPriority(b)
    if (categoryDelta !== 0) return categoryDelta
    const depthDelta = (a.target?.depth ?? 99) - (b.target?.depth ?? 99)
    if (depthDelta !== 0) return depthDelta
    return (b.target?.meshes.length ?? 0) - (a.target?.meshes.length ?? 0)
  })
}

function makePartId(typeKey, name) {
  return `auto_${typeKey.replace(/\./g, '_')}_${name.replace(/[^a-z0-9_-]/gi, '_')}`
}

function defaultStateForInteraction(interaction) {
  return interaction === 'toggle' || interaction === 'blink' || interaction === 'spin'
    ? 'off'
    : 'closed'
}

/**
 * Builds a complete PartRegistry from a Three.js scene and config.
 *
 * @param {THREE.Object3D} scene
 * @param {object} config
 * @param {object[]} [config.parts]
 * @param {number} [options.threshold=0.45]
 * @param {boolean} [options.autoDetect=true]
 * @param {boolean} [options.verbose=false]
 * @returns {{ registry: PartRegistry, meshIndex: Map, meshBounds: Map, stats: object, report: BuildReport }}
 */
export function buildPartRegistry(scene, config = {}, options = {}) {
  const { threshold = 0.45, autoDetect = true, verbose = false } = options

  scene.updateWorldMatrix(true, true)

  const legacyMeshIndex = indexMeshesByName(scene, verbose)
  const targetIndex = buildPartTargetIndex(scene, verbose)
  const meshIndex = mergeTargetMeshesIntoIndex(legacyMeshIndex, targetIndex)
  const targets = targetIndex.get('__all__') ?? []
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

  const manualNames = new Set()
  for (const partConfig of (config.parts ?? [])) {
    try {
      const entry = createPartEntry(partConfig, meshIndex, {}, targetIndex)
      if (entry) {
        registry.register(entry)
        report.manualParts.push({ id: entry.id, typeKey: entry.typeKey, meshNames: entry.meshNames })
        for (const n of entry.meshNames) manualNames.add(n)
        if (entry.rootName) manualNames.add(entry.rootName)
        if (entry.nodePath) manualNames.add(entry.nodePath)
      }
    } catch (err) {
      report.errors.push({ partConfig, error: err.message })
      if (verbose) console.error('[PartBuilder] Error creating part:', partConfig, err)
    }
  }

  if (autoDetect) {
    const candidateTargets = targets.filter((target) => (
      !manualNames.has(target.name)
      && !manualNames.has(target.rootName)
      && !manualNames.has(target.nodePath)
    ))

    const { detections, unmatched } = classifyTargets(candidateTargets, threshold)
    report.unmatched = unmatched

    spatiallyDisambiguate(detections, candidateTargets)
    sortDetections(detections)

    const registeredTargets = new Set()
    const claimedMeshUuids = new Set()

    for (const det of detections) {
      if (det.category === 'body' && targetHasDetectedDescendant(det, detections)) {
        if (verbose) console.log(`[PartBuilder] Skip broad body target "${det.meshName}"`)
        continue
      }

      const targetKey = det.targetId || det.meshName
      if (registeredTargets.has(targetKey)) continue

      const targetMeshes = det.target?.meshes ?? []
      if (targetMeshes.length > 0 && targetMeshes.every((mesh) => claimedMeshUuids.has(mesh.uuid))) {
        continue
      }

      const manualParts = registry.getByType(det.typeKey)
      const hasManual = manualParts.some(p => p.detection.method === 'manual')
      if (hasManual) continue

      const autoConfig = {
        id: makePartId(det.typeKey, det.meshName),
        typeKey: det.typeKey,
        label: det.label,
        rootName: det.rootName,
        nodePath: det.nodePath,
        meshNames: [det.meshName],
        origin: det.target?.origin?.toArray?.(),
        pivotSource: det.defaultInteraction === 'hinge_open_close'
          || det.defaultInteraction === 'fold'
          || det.defaultInteraction === 'spin'
          ? 'origin'
          : undefined,
        defaultState: defaultStateForInteraction(det.defaultInteraction),
        interactions: [det.defaultInteraction],
        visibleInUI: det.score >= 0.6 || det._spatiallyConfirmed,
      }
      if (det.defaultAxis) autoConfig.axis = det.defaultAxis
      if (det.defaultAxis && det.defaultInteraction === 'spin') autoConfig.spinAxis = det.defaultAxis
      if (det.defaultOpenAngle) autoConfig.openAngle = det.defaultOpenAngle

      try {
        const entry = createPartEntry(autoConfig, meshIndex, { score: det.score, method: det.method }, targetIndex)
        if (entry) {
          registry.register(entry)
          registeredTargets.add(targetKey)
          for (const mesh of entry.meshObjects) claimedMeshUuids.add(mesh.uuid)
          report.autoDetected.push({
            meshName: det.meshName,
            rootName: det.rootName,
            nodePath: det.nodePath,
            typeKey: det.typeKey,
            score: Math.round(det.score * 100) + '%',
            method: det.method,
            alternates: det.alternates?.map(a => `${a.typeKey}(${Math.round(a.score * 100)}%)`),
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
    console.log('Unmatched targets:', report.unmatched)
    if (report.errors.length) console.error('Errors:', report.errors)
    console.groupEnd()
  }

  return { registry, meshIndex, meshBounds, stats: sceneStats, report }
}

/**
 * Rebuilds the registry from an updated config.
 *
 * @param {import('./part-registry.js').PartRegistry} registry
 * @param {Map} meshIndex
 * @param {object[]} parts
 * @param {Map} [targetIndex]
 */
export function rebuildParts(registry, meshIndex, parts, targetIndex = null) {
  registry.clear()
  for (const partConfig of parts) {
    const entry = createPartEntry(partConfig, meshIndex, {}, targetIndex)
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
