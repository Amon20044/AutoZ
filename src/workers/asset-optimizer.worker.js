import { WebIO } from '@gltf-transform/core'
import { EXTMeshoptCompression } from '@gltf-transform/extensions'
import {
  dedup,
  meshopt,
  prune,
  quantize,
  resample,
  simplify,
  textureCompress,
  TextureResizeFilter,
  weld,
} from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import { LOD_VARIANTS } from '../lib/assets/lod-profiles.js'
import { createBaseAssetManifest } from '../lib/assets/manifest.js'

let cancelled = false

function postProgress(stage, progress, message) {
  self.postMessage({ type: 'PROGRESS', stage, progress, message })
}

function countTriangles(doc) {
  let triangles = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices()
      const position = prim.getAttribute('POSITION')
      const mode = prim.getMode()
      if (mode !== 4) continue
      triangles += indices
        ? Math.floor(indices.getCount() / 3)
        : Math.floor((position?.getCount() || 0) / 3)
    }
  }
  return triangles
}

function inspectStats(doc) {
  const root = doc.getRoot()
  return {
    originalTriangles: countTriangles(doc),
    materialCount: root.listMaterials().length,
    textureCount: root.listTextures().length,
    drawCallEstimate: root.listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().length, 0),
  }
}

function createIo() {
  return new WebIO()
    .registerExtensions([EXTMeshoptCompression])
    .registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
    })
}

async function optimizeLod({ buffer, lod, geometryCompression, textureMode }) {
  const io = createIo()
  const doc = await io.readBinary(new Uint8Array(buffer))
  const transforms = [
    dedup(),
    prune(),
  ]

  if (textureMode !== 'none') {
    transforms.push(textureCompress({
      targetFormat: 'webp',
      resize: [lod.maxTextureSize, lod.maxTextureSize],
      resizeFilter: TextureResizeFilter.LANCZOS2,
      quality: lod.maxTextureSize <= 512 ? 72 : 82,
      effort: 50,
    }))
  }

  transforms.push(
    weld({ tolerance: 0.00001 }),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: lod.triangleRatio,
      error: 0.0001,
      lockBorder: true,
    }),
    quantize({
      quantizePosition: 14,
      quantizeNormal: 10,
      quantizeTexcoord: 12,
      quantizeColor: 8,
    }),
    resample(),
    prune(),
  )

  if (geometryCompression === 'meshopt') {
    transforms.push(meshopt({ encoder: MeshoptEncoder }))
  }

  await doc.transform(...transforms)
  const triangles = countTriangles(doc)
  const output = await io.writeBinary(doc)
  return {
    blob: new Blob([output], { type: 'model/gltf-binary' }),
    triangles,
  }
}

async function optimizePublishModel(message) {
  cancelled = false
  const { fileName, buffer, options = {} } = message
  const textureMode = options.textureMode || 'webp'
  const maxTextureSize = options.maxTextureSize || 2048

  postProgress('read', 0.04, 'Reading GLB')
  const io = createIo()
  const doc = await io.readBinary(new Uint8Array(buffer))
  const before = {
    bytes: buffer.byteLength,
    ...inspectStats(doc),
  }

  const transforms = [
    dedup(),
    prune(),
    weld({ tolerance: 0.00001 }),
  ]

  if (textureMode !== 'none') {
    postProgress('textures', 0.28, 'Optimizing textures')
    transforms.push(textureCompress({
      targetFormat: 'webp',
      resize: [maxTextureSize, maxTextureSize],
      resizeFilter: TextureResizeFilter.LANCZOS2,
      quality: 88,
      effort: 50,
    }))
  }

  transforms.push(
    quantize({
      quantizePosition: 14,
      quantizeNormal: 10,
      quantizeTexcoord: 12,
      quantizeColor: 8,
    }),
    resample(),
    prune(),
  )

  postProgress('geometry', 0.55, 'Packing geometry')
  await doc.transform(...transforms)
  if (cancelled) return

  postProgress('write', 0.86, 'Writing optimized GLB')
  const output = await io.writeBinary(doc)
  const blob = new Blob([output], { type: 'model/gltf-binary' })
  const optimizedName = fileName.replace(/\.(glb|gltf)$/i, '') + '.optimized.glb'
  self.postMessage({
    type: 'PUBLISH_MODEL_READY',
    blob,
    fileName: optimizedName,
    metadata: {
      originalBytes: before.bytes,
      optimizedBytes: blob.size,
      originalTriangles: before.originalTriangles,
      triangles: countTriangles(doc),
      materialCount: before.materialCount,
      textureCount: before.textureCount,
      compression: {
        geometry: 'quantized',
        textures: textureMode === 'none' ? 'source' : 'webp',
        textureFallback: textureMode === 'none' ? 'source' : 'webp',
      },
    },
  })
  postProgress('done', 1, 'Optimized model ready')
}

async function processAsset(message) {
  cancelled = false
  const { fileName, buffer, options = {}, assetId, publicUrls = {} } = message
  const geometryCompression = options.geometryCompression || 'meshopt'
  const textureMode = options.textureMode || 'webp'

  postProgress('read', 0.02, 'Reading GLB')
  await MeshoptEncoder.ready
  await MeshoptSimplifier.ready

  const inspectDoc = await createIo().readBinary(new Uint8Array(buffer))
  const stats = inspectStats(inspectDoc)
  postProgress('inspect', 0.08, `${stats.originalTriangles.toLocaleString()} triangles`)

  const lodMetadata = {}
  const total = LOD_VARIANTS.length

  for (let i = 0; i < LOD_VARIANTS.length; i += 1) {
    if (cancelled) return

    const lod = LOD_VARIANTS[i]
    const startProgress = 0.1 + (i / total) * 0.78
    const endProgress = 0.1 + ((i + 1) / total) * 0.78
    postProgress(lod.id, startProgress, `Generating ${lod.id}`)

    let result
    try {
      result = await optimizeLod({ buffer, lod, geometryCompression, textureMode })
    } catch (err) {
      postProgress(lod.id, startProgress, `${lod.id} optimization fallback: ${err.message}`)
      result = {
        blob: new Blob([buffer.slice(0)], { type: 'model/gltf-binary' }),
        triangles: stats.originalTriangles,
      }
    }

    lodMetadata[lod.id] = {
      bytes: result.blob.size,
      triangles: result.triangles,
      maxTextureSize: lod.maxTextureSize,
    }

    self.postMessage({
      type: 'FILE_READY',
      fileKey: lod.key,
      blob: result.blob,
      metadata: {
        lodId: lod.id,
        bytes: result.blob.size,
        triangles: result.triangles,
        maxTextureSize: lod.maxTextureSize,
      },
    })

    postProgress(lod.id, endProgress, `${lod.id} ready`)
  }

  if (cancelled) return

  const manifest = createBaseAssetManifest({
    assetId,
    fileName,
    originalBytes: buffer.byteLength,
    publicUrls,
    lodMetadata,
    storedOriginal: false,
    stats,
    compression: {
      geometry: geometryCompression,
      textures: textureMode === 'none' ? 'source' : 'webp',
      textureFallback: textureMode === 'none' ? 'source' : 'webp',
    },
  })
  manifest.manifestUrl = publicUrls['manifest.json'] || ''
  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })

  self.postMessage({
    type: 'FILE_READY',
    fileKey: 'manifest.json',
    blob: manifestBlob,
    metadata: {
      bytes: manifestBlob.size,
    },
  })

  postProgress('manifest', 0.96, 'Manifest ready')
  self.postMessage({ type: 'DONE', manifest })
  postProgress('done', 1, 'Done')
}

self.onmessage = (event) => {
  const message = event.data
  if (message?.type === 'CANCEL') {
    cancelled = true
    return
  }

  if (message?.type === 'PROCESS_ASSET') {
    processAsset(message).catch((err) => {
      self.postMessage({ type: 'ERROR', error: err.message || String(err) })
    })
  } else if (message?.type === 'PROCESS_PUBLISH_MODEL') {
    optimizePublishModel(message).catch((err) => {
      self.postMessage({ type: 'ERROR', error: err.message || String(err) })
    })
  }
}
