import { createBaseAssetManifest } from './manifest.js'
import { getExpectedAssetFiles, LOD_VARIANTS } from './lod-profiles.js'

const ASSET_WORKER_URL = new URL('../../workers/asset-optimizer.worker.js', import.meta.url)
const MANIFEST_KEY = 'manifest.json'

function xhrUpload(url, blob, contentType, { signal, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    const abort = () => {
      xhr.abort()
      reject(new DOMException('Upload cancelled.', 'AbortError'))
    }

    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })

    xhr.open('PUT', url, true)
    xhr.setRequestHeader('Content-Type', contentType || blob.type || 'application/octet-stream')

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return
      onProgress?.({
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      })
    })

    xhr.addEventListener('load', () => {
      signal?.removeEventListener('abort', abort)
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Upload failed with HTTP ${xhr.status}.`))
      }
    })

    xhr.addEventListener('error', () => {
      signal?.removeEventListener('abort', abort)
      reject(new Error('Network error during upload.'))
    })

    xhr.addEventListener('abort', () => {
      signal?.removeEventListener('abort', abort)
    })

    xhr.send(blob)
  })
}

function createAssetWorker() {
  return new Worker(ASSET_WORKER_URL, { type: 'module' })
}

function getWorkerConcurrency(options = {}) {
  const requested = Number(options.workerConcurrency)
  if (Number.isFinite(requested) && requested > 0) {
    return Math.max(1, Math.min(LOD_VARIANTS.length, Math.floor(requested)))
  }

  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4
  const memory = typeof navigator !== 'undefined' ? navigator.deviceMemory || 4 : 4

  if (cores >= 8 && memory >= 8) return Math.min(3, LOD_VARIANTS.length)
  if (cores >= 4) return Math.min(2, LOD_VARIANTS.length)
  return 1
}

function createAbortError(message) {
  return new DOMException(message, 'AbortError')
}

function runWorkerTask({
  type,
  payload,
  transfer = [],
  resolveType,
  signal,
  onProgress,
}) {
  const worker = createAssetWorker()

  return new Promise((resolve, reject) => {
    let settled = false

    const settle = (fn, value) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      fn(value)
    }

    const abort = () => {
      try {
        worker.postMessage({ type: 'CANCEL' })
      } catch {
        // Worker may already be gone.
      }
      settle(reject, createAbortError('Asset upload cancelled.'))
    }

    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })

    worker.onmessage = (event) => {
      const message = event.data

      if (message.type === 'PROGRESS') {
        onProgress?.(message)
        return
      }

      if (message.type === 'ERROR') {
        settle(reject, new Error(message.error || 'Asset worker failed.'))
        return
      }

      if (message.type === resolveType) {
        settle(resolve, message)
      }
    }

    worker.onerror = (event) => {
      settle(reject, new Error(event.message || 'Asset worker crashed.'))
    }

    worker.postMessage({ type, ...payload }, transfer)
  })
}

async function runParallelQueue(items, concurrency, runItem) {
  let nextIndex = 0

  const runNext = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      await runItem(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()),
  )
}

function createProgressAggregator(onProgress) {
  const lodProgress = new Map()
  let analyzeProgress = 0

  const emit = (stage, progress, message) => {
    onProgress?.({
      type: 'worker',
      stage,
      progress: Math.max(0, Math.min(1, progress)),
      message,
    })
  }

  return {
    analyze(message) {
      analyzeProgress = message.progress ?? analyzeProgress
      emit(message.stage, analyzeProgress * 0.08, message.message)
    },
    lod(message) {
      lodProgress.set(message.stage, message.progress ?? 0)
      const lodAverage = LOD_VARIANTS.reduce(
        (sum, lod) => sum + (lodProgress.get(lod.id) ?? 0),
        0,
      ) / LOD_VARIANTS.length

      emit(message.stage, 0.08 + lodAverage * 0.82, message.message)
    },
    manifest(message = 'Building manifest') {
      emit('manifest', 0.96, message)
    },
    done() {
      emit('done', 1, 'Done')
    },
  }
}

function startUpload({ init, uploads, fileKey, blob, metadata, signal, onProgress }) {
  const uploadUrl = init.uploadUrls[fileKey]
  if (!uploadUrl) throw new Error(`No upload URL for ${fileKey}.`)

  let upload
  upload = xhrUpload(uploadUrl, blob, blob.type, {
    signal,
    onProgress: (progress) => {
      onProgress?.({
        type: 'upload',
        fileKey,
        metadata,
        ...progress,
      })
    },
  }).finally(() => {
    uploads.delete(upload)
  })

  uploads.add(upload)
  return upload
}

export async function generateOptimizedAssetFiles(file, {
  signal,
  onProgress,
  onFile,
  options = {},
  assetId = 'local',
  publicUrls = {},
} = {}) {
  const buffer = await file.arrayBuffer()
  const workerOptions = {
    geometryCompression: options.geometryCompression || 'meshopt',
    textureMode: options.textureMode || 'ktx2',
    generateOriginalBackup: Boolean(options.generateOriginalBackup),
    lodProfile: options.lodProfile || 'auto',
  }
  const progress = createProgressAggregator(onProgress)
  const lodMetadata = {}
  const generatedFiles = []
  const concurrency = getWorkerConcurrency(options)
  const statsBuffer = buffer.slice(0)

  const emitFile = (entry) => {
    generatedFiles.push(entry)
    onFile?.(entry)
  }

  const statsPromise = runWorkerTask({
    type: 'PROCESS_ASSET_ANALYZE',
    payload: { buffer: statsBuffer },
    transfer: [statsBuffer],
    resolveType: 'ASSET_ANALYZED',
    signal,
    onProgress: progress.analyze,
  }).then((message) => message.stats)

  const lodsPromise = runParallelQueue(LOD_VARIANTS, concurrency, async (lod) => {
    const lodBuffer = buffer.slice(0)
    const message = await runWorkerTask({
      type: 'PROCESS_ASSET_LOD',
      payload: {
        lodId: lod.id,
        buffer: lodBuffer,
        options: workerOptions,
      },
      transfer: [lodBuffer],
      resolveType: 'LOD_READY',
      signal,
      onProgress: progress.lod,
    })

    lodMetadata[message.metadata.lodId] = {
      bytes: message.metadata.bytes,
      triangles: message.metadata.triangles,
      maxTextureSize: message.metadata.maxTextureSize,
      textureFormat: message.metadata.textureFormat,
    }

    emitFile({
      fileKey: message.fileKey,
      blob: message.blob,
      metadata: message.metadata,
    })
  })

  const [stats] = await Promise.all([statsPromise, lodsPromise])
  progress.manifest()

  const manifest = createBaseAssetManifest({
    assetId,
    fileName: file.name,
    originalBytes: buffer.byteLength,
    publicUrls,
    lodMetadata,
    storedOriginal: false,
    stats,
    compression: {
      geometry: workerOptions.geometryCompression,
      textures: workerOptions.textureMode === 'none' ? 'source' : workerOptions.textureMode,
      textureFallback: workerOptions.textureMode === 'none' ? 'source' : 'webp',
    },
  })
  manifest.manifestUrl = publicUrls[MANIFEST_KEY] || ''

  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: 'application/json',
  })
  emitFile({
    fileKey: MANIFEST_KEY,
    blob: manifestBlob,
    metadata: { bytes: manifestBlob.size },
    manifest,
  })

  progress.done()
  return { manifest, files: generatedFiles }
}

export async function uploadOptimizedAsset(file, {
  signal,
  onProgress,
  options = {},
} = {}) {
  const files = getExpectedAssetFiles({
    includeOriginal: Boolean(options.generateOriginalBackup),
  })
  const initRes = await fetch('/api/assets/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      files,
    }),
    signal,
  })
  const init = await initRes.json()
  if (!initRes.ok) throw new Error(init.error || 'Could not initialize asset upload.')

  const uploads = new Set()
  const uploadPromises = []

  const { manifest: finalManifest } = await generateOptimizedAssetFiles(file, {
    signal,
    onProgress,
    options,
    assetId: init.assetId,
    publicUrls: init.publicUrls,
    onFile: (message) => {
      uploadPromises.push(startUpload({
        init,
        uploads,
        fileKey: message.fileKey,
        blob: message.blob,
        metadata: message.metadata,
        signal,
        onProgress,
      }))
    },
  })

  await Promise.all(uploadPromises)

  const finalizeRes = await fetch('/api/assets/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assetId: init.assetId,
      manifest: finalManifest,
    }),
    signal,
  })
  const finalize = await finalizeRes.json()
  if (!finalizeRes.ok) throw new Error(finalize.error || 'Could not finalize asset.')

  return { assetId: init.assetId, manifest: finalManifest }
}
