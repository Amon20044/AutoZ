/**
 * @module engine/pipeline/import-pipeline
 * Client-side GLB/GLTF import, normalization, and part detection pipeline.
 *
 * Supports:
 *   - Single .glb file (self-contained binary)
 *   - Multi-file .gltf folder drop (scene.gltf + scene.bin + textures/)
 *
 * Emits live step events to processingBus throughout.
 * Returns a fully built ImportResult.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { computeBoundingBox, computeNormalization, applyNormalization } from '../math/normalization.js'
import { buildPartRegistry } from '../core/part-builder.js'
import { processingBus, emitStep, PIPELINE_STEPS as S } from './processing-bus.js'

// ─── Validation ───────────────────────────────────────────────────────────────

const MODEL_EXTENSIONS = new Set(['.glb', '.gltf'])
const MAX_FILE_SIZE_MB = 150

/**
 * @param {File} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateModelFile(file) {
  const ext = '.' + file.name.split('.').pop().toLowerCase()
  if (!MODEL_EXTENSIONS.has(ext)) {
    return { valid: false, error: `Unsupported format "${ext}". Supported: GLB, GLTF.` }
  }
  const sizeMB = file.size / 1024 / 1024
  if (sizeMB > MAX_FILE_SIZE_MB) {
    return { valid: false, error: `File too large (${sizeMB.toFixed(1)} MB). Max: ${MAX_FILE_SIZE_MB} MB.` }
  }
  return { valid: true }
}

// ─── GLTF Loader (singleton, with Draco) ─────────────────────────────────────

let _loader = null
function getLoader(manager) {
  const draco = new DRACOLoader()
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')
  const loader = new GLTFLoader(manager)
  loader.setDRACOLoader(draco)
  loader.setMeshoptDecoder(MeshoptDecoder)
  return loader
}

// ─── Multi-File GLTF Resolution ───────────────────────────────────────────────

/**
 * Build a virtual file map from an array of { path, file } entries.
 * Normalizes paths so both "textures/foo.png" and "scene/textures/foo.png" resolve.
 *
 * @param {{ path: string, file: File }[]} files
 * @returns {{ gltfFile: File | null, fileMap: Map<string, File> }}
 */
export function buildFileMap(files) {
  /** @type {Map<string, File>} normalized relative path → File */
  const fileMap = new Map()
  let gltfFile = null

  // Find the .gltf entry point and use its directory as the base
  let gltfDir = ''
  for (const { path, file } of files) {
    const lower = path.toLowerCase()
    if (lower.endsWith('.gltf')) {
      gltfFile = file
      // Base directory: everything before the last /
      const lastSlash = path.lastIndexOf('/')
      gltfDir = lastSlash >= 0 ? path.substring(0, lastSlash + 1) : ''
      break
    }
  }

  // Also check for .glb as entry point
  if (!gltfFile) {
    for (const { path, file } of files) {
      if (path.toLowerCase().endsWith('.glb')) {
        gltfFile = file
        break
      }
    }
    // .glb is self-contained, no need for fileMap
    if (gltfFile) return { gltfFile, fileMap }
  }

  // Build map with paths relative to the .gltf file
  for (const { path, file } of files) {
    // Store with multiple key variants for robust lookup
    const relative = gltfDir && path.startsWith(gltfDir)
      ? path.substring(gltfDir.length)
      : path
    const normalized = relative.replace(/\\/g, '/')

    fileMap.set(normalized, file)
    fileMap.set(normalized.toLowerCase(), file)
    // Also store just the filename for fallback matching
    const basename = normalized.split('/').pop()
    if (basename && !fileMap.has(basename)) {
      fileMap.set(basename, file)
      fileMap.set(basename.toLowerCase(), file)
    }
  }

  return { gltfFile, fileMap }
}

/**
 * Rewrites a GLTF JSON's buffer and image URIs to blob URLs.
 * This allows GLTFLoader.parse() to load external references from in-memory files.
 *
 * @param {ArrayBuffer} gltfBuffer - The raw .gltf file contents
 * @param {Map<string, File>} fileMap - Relative path → File
 * @returns {Promise<{ rewrittenBuffer: ArrayBuffer, blobUrls: string[] }>}
 */
async function rewriteGltfUris(gltfBuffer, fileMap) {
  const jsonText = new TextDecoder().decode(gltfBuffer)
  const gltfJson = JSON.parse(jsonText)
  const blobUrls = []

  // Resolve a URI against the file map (with fuzzy fallback)
  const resolveUri = (uri) => {
    if (!uri || uri.startsWith('data:')) return null

    const decoded = decodeURIComponent(uri)
    const normalized = decoded.replace(/\\/g, '/')

    // Exact match
    let file = fileMap.get(normalized) || fileMap.get(normalized.toLowerCase())
    if (file) return file

    // Basename match (handles "textures/foo.png" vs "foo.png")
    const basename = normalized.split('/').pop()
    file = fileMap.get(basename) || fileMap.get(basename?.toLowerCase())
    if (file) return file

    // Fuzzy: find a key that ends with the normalized path
    for (const [key, f] of fileMap) {
      if (key.endsWith(normalized) || key.endsWith(basename)) return f
    }

    return null
  }

  // Rewrite buffer URIs
  for (const buffer of (gltfJson.buffers ?? [])) {
    if (!buffer.uri || buffer.uri.startsWith('data:')) continue
    const file = resolveUri(buffer.uri)
    if (file) {
      const url = URL.createObjectURL(file)
      blobUrls.push(url)
      buffer.uri = url
    } else {
      console.warn(`[ImportPipeline] Could not resolve buffer: ${buffer.uri}`)
    }
  }

  // Rewrite image URIs
  for (const image of (gltfJson.images ?? [])) {
    if (!image.uri || image.uri.startsWith('data:')) continue
    const file = resolveUri(image.uri)
    if (file) {
      const url = URL.createObjectURL(file)
      blobUrls.push(url)
      image.uri = url
    } else {
      console.warn(`[ImportPipeline] Could not resolve texture: ${image.uri}`)
    }
  }

  // Convert back to ArrayBuffer
  const rewrittenJson = JSON.stringify(gltfJson)
  const rewrittenBuffer = new TextEncoder().encode(rewrittenJson).buffer
  return { rewrittenBuffer, blobUrls }
}

// ─── Main Pipeline ────────────────────────────────────────────────────────────

/**
 * Run the full import pipeline from an array of dropped files.
 *
 * @param {{ path: string, file: File }[]} droppedFiles - Files from ModelUploader
 * @param {object} [importOptions]
 * @param {string} [importOptions.sourceUnit='meter']
 * @param {number[]} [importOptions.sourceForward=[0,0,1]]
 * @param {number} [importOptions.targetMaxDimension=6.0]
 * @param {object[]} [importOptions.parts=[]] - Pre-configured parts (from editor)
 * @returns {Promise<ImportResult>}
 */
export async function runImportPipeline(droppedFiles, importOptions = {}) {
  const startTime = Date.now()
  const emit = (id, label, status, detail, data) =>
    emitStep(id, label, status, detail, data, startTime)

  const blobUrlsToRevoke = []

  try {
    // ── Step 1: Validate & Resolve Files ─────────────────────────────────
    emit(S.VALIDATE, 'Resolving files', 'running',
      `${droppedFiles.length} file(s) dropped`)

    const { gltfFile, fileMap } = buildFileMap(droppedFiles)

    if (!gltfFile) {
      const err = 'No .glb or .gltf file found in the dropped files.'
      emit(S.VALIDATE, 'Validation failed', 'error', err)
      throw new Error(err)
    }

    const validation = validateModelFile(gltfFile)
    if (!validation.valid) {
      emit(S.VALIDATE, 'Validation failed', 'error', validation.error)
      throw new Error(validation.error)
    }

    const ext = gltfFile.name.split('.').pop().toLowerCase()
    const totalSize = droppedFiles.reduce((s, f) => s + f.file.size, 0)

    emit(S.VALIDATE, 'Files resolved', 'done',
      `${gltfFile.name} (${ext.toUpperCase()}) + ${fileMap.size} companion files, ${(totalSize / 1024 / 1024).toFixed(1)} MB total`,
      { entry: gltfFile.name, companions: fileMap.size, totalSize }
    )

    // ── Step 2: Parse ────────────────────────────────────────────────────
    emit(S.PARSE, 'Parsing 3D model', 'running', 'Reading files into memory...')

    let arrayBuffer = await gltfFile.arrayBuffer()

    // For .gltf with external files → rewrite URIs to blob URLs
    if (ext === 'gltf' && fileMap.size > 0) {
      emit(S.PARSE, 'Parsing 3D model', 'running',
        `Resolving ${fileMap.size} external files (buffers + textures)...`)

      const { rewrittenBuffer, blobUrls } = await rewriteGltfUris(arrayBuffer, fileMap)
      arrayBuffer = rewrittenBuffer
      blobUrlsToRevoke.push(...blobUrls)

      emit(S.PARSE, 'Parsing 3D model', 'running',
        `Resolved ${blobUrls.length} external references. Decoding with GLTFLoader...`)
    } else {
      emit(S.PARSE, 'Parsing 3D model', 'running', 'Decoding with GLTFLoader + Draco...')
    }

    const loader = getLoader()
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(arrayBuffer, '', resolve, (err) => {
        reject(err instanceof Error ? err : new Error(err?.message ?? 'GLTFLoader parse failed'))
      })
    })

    // Collect scene stats
    let meshCount = 0, totalVerts = 0, totalTris = 0, matSet = new Set()
    gltf.scene.traverse((c) => {
      if (!c.isMesh) return
      meshCount++
      const geo = c.geometry
      if (geo.attributes.position) totalVerts += geo.attributes.position.count
      totalTris += geo.index ? geo.index.count / 3 : (geo.attributes.position?.count ?? 0) / 3
      const mats = Array.isArray(c.material) ? c.material : [c.material]
      mats.forEach((m) => matSet.add(m.name || m.uuid))
    })

    const sceneStats = { meshCount, totalVerts, totalTris: Math.round(totalTris), uniqueMaterials: matSet.size }
    emit(S.PARSE, 'Model parsed', 'done',
      `${meshCount} meshes, ${Math.round(totalTris / 1000)}k triangles, ${matSet.size} materials`, sceneStats)

    // ── Step 3: Normalize ────────────────────────────────────────────────
    emit(S.NORMALIZE, 'Normalizing model', 'running', 'Computing bounding box, scale, ground alignment...')

    const rawBbox = computeBoundingBox(gltf.scene)
    const normResult = computeNormalization({
      boundingBox: { min: rawBbox.min, max: rawBbox.max },
      sourceUnit: importOptions.sourceUnit ?? 'meter',
      targetMaxDimension: importOptions.targetMaxDimension ?? 6.0,
      sourceForward: importOptions.sourceForward ?? [0, 0, 1],
      targetForward: [0, 0, 1],
    })

    emit(S.NORMALIZE, 'Normalization complete', 'done',
      `Scale: ×${normResult.scaleFactor.toFixed(3)}, Dims: ${normResult.dimensions.width.toFixed(2)}×${normResult.dimensions.height.toFixed(2)}×${normResult.dimensions.depth.toFixed(2)}m`,
      { normResult }
    )

    // ── Step 4: Detect Parts ─────────────────────────────────────────────
    emit(S.DETECT, 'Detecting car parts', 'running', 'Running fuzzy + regex hybrid classifier...')

    const sceneClone = gltf.scene.clone()
    const normalizedRoot = applyNormalization(sceneClone, normResult)

    // Force full world matrix update so all meshes have correct world positions
    // BEFORE part detection and pivot computation runs
    normalizedRoot.updateWorldMatrix(true, true)

    const { registry, meshIndex, report } = buildPartRegistry(
      normalizedRoot,
      { parts: importOptions.parts ?? [] },
      { autoDetect: true, verbose: false },
    )

    const detCount = report.autoDetected.length + report.manualParts.length
    emit(S.DETECT, 'Part detection complete', 'done',
      `${detCount} parts detected (${report.autoDetected.length} auto, ${report.manualParts.length} manual), ${report.unmatched.length} unmatched meshes`,
      { detections: report.autoDetected, unmatched: report.unmatched }
    )

    // ── Step 5: Materials ────────────────────────────────────────────────
    emit(S.MATERIALS, 'Analyzing materials', 'running', 'Cataloging materials and textures...')

    const textures = []
    gltf.scene.traverse((c) => {
      if (!c.isMesh) return
      const mats = Array.isArray(c.material) ? c.material : [c.material]
      for (const mat of mats) {
        if (mat.map) textures.push({ name: mat.map.name || 'diffuse', type: 'map', source: mat.name })
        if (mat.normalMap) textures.push({ name: mat.normalMap.name || 'normal', type: 'normalMap', source: mat.name })
        if (mat.roughnessMap) textures.push({ name: mat.roughnessMap.name || 'roughness', type: 'roughnessMap', source: mat.name })
        if (mat.metalnessMap) textures.push({ name: mat.metalnessMap.name || 'metalness', type: 'metalnessMap', source: mat.name })
        if (mat.emissiveMap) textures.push({ name: mat.emissiveMap.name || 'emissive', type: 'emissiveMap', source: mat.name })
        if (mat.aoMap) textures.push({ name: mat.aoMap.name || 'ao', type: 'aoMap', source: mat.name })
      }
    })

    emit(S.MATERIALS, 'Materials analyzed', 'done', `${textures.length} texture maps found`, { textures })

    // ── Done ─────────────────────────────────────────────────────────────
    emit(S.READY, 'Model ready', 'done',
      `Loaded in ${((Date.now() - startTime) / 1000).toFixed(2)}s`, { totalTime: Date.now() - startTime }
    )

    return {
      gltf,
      normalizedRoot,
      normResult,
      registry,
      meshIndex,
      report,
      sceneStats,
      textures,
      file: { name: gltfFile.name, size: gltfFile.size },
      _blobUrls: blobUrlsToRevoke, // caller should revoke on cleanup
    }

  } catch (err) {
    // Clean up blob URLs on error
    for (const url of blobUrlsToRevoke) URL.revokeObjectURL(url)
    emit(S.ERROR, 'Pipeline error', 'error', err.message)
    throw err
  }
}

/**
 * @typedef {object} ImportResult
 * @property {import('three-stdlib').GLTF} gltf
 * @property {THREE.Group} normalizedRoot
 * @property {object} normResult
 * @property {import('../core/part-registry.js').PartRegistry} registry
 * @property {Map} meshIndex
 * @property {object} report
 * @property {object} sceneStats
 * @property {object[]} textures
 * @property {{ name: string, size: number }} file
 * @property {string[]} _blobUrls - Internal: revoke on cleanup
 */
