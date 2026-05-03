const CHUNK_CACHE_NAME = 'autoz-chunked-model-v1'
const CHUNK_CACHE_META_PREFIX = 'autoz:chunk-cache:'
const CHUNK_CACHE_TTL_MS = 5 * 60 * 1000
const CHUNK_FETCH_CONCURRENCY = 6
// Chunks are reassembled by index, so network fetches can run concurrently.
const SEQUENTIAL_PREFIX_CHUNKS = 0

export function normalizeStorageUrl(url) {
  if (!url || typeof url !== 'string') return url

  try {
    const parsed = new URL(url)
    if (
      parsed.hostname.endsWith('.storage.supabase.co')
      && parsed.pathname.includes('/storage/v1/s3/')
    ) {
      parsed.hostname = parsed.hostname.replace('.storage.supabase.co', '.supabase.co')
      parsed.pathname = parsed.pathname.replace('/storage/v1/s3/', '/storage/v1/')
      return parsed.toString()
    }
  } catch {
    // Return the original value and let fetch/loaders report the real failure.
  }

  return url
}

export function isChunkedModel(model) {
  return Boolean(
    model?.chunked
    || model?.isChunked
    || model?.manifestUrl
    || model?.manifest?.chunks?.length
    || (typeof model?.url === 'string' && /\/manifest\.json(?:$|\?)/.test(model.url)),
  )
}

function hasBrowserCache() {
  return typeof window !== 'undefined' && typeof window.caches !== 'undefined'
}

function getStorage() {
  if (typeof window === 'undefined') return null
  return window.localStorage || window.sessionStorage || null
}

function getMetaKey(url) {
  return `${CHUNK_CACHE_META_PREFIX}${url}`
}

function readChunkMeta(url) {
  const storage = getStorage()
  if (!storage) return null

  try {
    const raw = storage.getItem(getMetaKey(url))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeChunkMeta(url, meta) {
  const storage = getStorage()
  if (!storage) return

  try {
    storage.setItem(getMetaKey(url), JSON.stringify(meta))
  } catch {
    // Quota pressure should not block model loading.
  }
}

function removeChunkMeta(url) {
  const storage = getStorage()
  if (!storage) return

  try {
    storage.removeItem(getMetaKey(url))
  } catch {
    // Ignore storage cleanup failures.
  }
}

function resolveChunkUrl(part, manifestUrl) {
  try {
    return new URL(part).toString()
  } catch {
    return new URL(part, manifestUrl).toString()
  }
}

function buildProgressParts(manifest) {
  const equalChunkSize = manifest.chunkSize || 0
  const lastSize = manifest.size && equalChunkSize
    ? manifest.size - equalChunkSize * (manifest.chunks.length - 1)
    : equalChunkSize

  return manifest.chunks.map((part, index) => ({
    index,
    name: part,
    size: index === manifest.chunks.length - 1 && lastSize > 0 ? lastSize : equalChunkSize,
    uploaded: 0,
    percent: 0,
    status: 'pending',
    cached: false,
  }))
}

function emitProgress(onProgress, phase, payload) {
  onProgress?.({
    phase,
    fileName: payload.fileName,
    totalBytes: payload.totalBytes,
    uploadedBytes: payload.uploadedBytes,
    percent: payload.percent,
    totalParts: payload.totalParts,
    completedParts: payload.completedParts,
    currentPart: payload.currentPart ?? null,
    statusText: payload.statusText ?? '',
    parts: payload.parts?.map((part) => ({ ...part })),
    cachedParts: payload.cachedParts ?? 0,
  })
}

function sanitizeFetchedManifest({ manifest, manifestUrl }) {
  const chunks = (manifest?.chunks ?? []).map((part) =>
    normalizeStorageUrl(resolveChunkUrl(part, manifestUrl)),
  )
  return { ...manifest, chunks }
}

export async function fetchChunkedModelManifest(model, options = {}) {
  const manifestUrl = normalizeStorageUrl(model?.manifestUrl || model?.url)
  if (!manifestUrl) throw new Error('Chunked model is missing a manifest URL.')

  emitProgress(options.onProgress, 'manifest', {
    fileName: model?.fileName || 'model.glb',
    totalBytes: model?.fileSize || 0,
    uploadedBytes: 0,
    percent: 0,
    totalParts: model?.manifest?.chunks?.length || 0,
    completedParts: 0,
    statusText: 'Loading manifest.json',
    parts: [],
  })

  if (model?.manifest?.chunks?.length) {
    const manifest = sanitizeFetchedManifest({ manifest: model.manifest, manifestUrl })
    return { manifest, manifestUrl }
  }

  const res = await fetch(manifestUrl, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Could not load model manifest (${res.status}).`)

  const raw = await res.json()
  if (!Array.isArray(raw.chunks) || raw.chunks.length === 0) {
    throw new Error('Model manifest does not contain any chunks.')
  }

  const manifest = sanitizeFetchedManifest({ manifest: raw, manifestUrl })
  return { manifest, manifestUrl }
}

async function fetchCachedChunk(url, contentType) {
  if (!hasBrowserCache()) return null

  const meta = readChunkMeta(url)
  if (!meta || meta.expiresAt <= Date.now()) {
    removeChunkMeta(url)
    try {
      const cache = await window.caches.open(CHUNK_CACHE_NAME)
      await cache.delete(url)
    } catch {
      // Ignore cache cleanup failures.
    }
    return null
  }

  try {
    const cache = await window.caches.open(CHUNK_CACHE_NAME)
    const cached = await cache.match(url)
    if (!cached) return null
    const blob = await cached.blob()
    return blob.type ? blob : new Blob([blob], { type: contentType })
  } catch {
    return null
  }
}

async function writeCachedChunk(url, blob, contentType) {
  if (!hasBrowserCache()) return

  try {
    const cache = await window.caches.open(CHUNK_CACHE_NAME)
    await cache.put(url, new Response(blob, {
      headers: {
        'Content-Type': blob.type || contentType,
        'Cache-Control': 'max-age=300',
      },
    }))
    writeChunkMeta(url, {
      expiresAt: Date.now() + CHUNK_CACHE_TTL_MS,
      size: blob.size,
    })
  } catch {
    // Cache failures should not block the viewer.
  }
}

async function fetchChunk(url, contentType) {
  const cached = await fetchCachedChunk(url, contentType)
  if (cached) return { blob: cached, cached: true }

  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Could not load model chunk ${url}.`)

  const blob = await res.blob()
  await writeCachedChunk(url, blob, contentType)
  return { blob, cached: false }
}

export async function fetchChunkedModelBlob(model, options = {}) {
  const { manifest } = await fetchChunkedModelManifest(model, options)
  const contentType = manifest.contentType || model?.contentType || 'model/gltf-binary'
  const fileName = model?.fileName || manifest.fileName || 'model.glb'
  const totalBytes = manifest.size || model?.fileSize || 0

  /** Basenames for ui progress only — byte estimate still uses manifest.chunkSize/size */
  const namesForParts = manifest.chunks.map((raw) => {
    if (typeof raw !== 'string') return String(raw)
    try {
      return new URL(raw).pathname.split('/').pop() || raw
    } catch {
      return raw.split('/').pop() || raw
    }
  })

  const progressParts = buildProgressParts({ ...manifest, chunks: namesForParts })

  const blobs = new Array(manifest.chunks.length)
  let nextIndex = 0
  let completedParts = 0
  let completedBytes = 0
  let cachedParts = 0

  const emitReport = (phase, currentPart, statusText) => {
    emitProgress(options.onProgress, phase, {
      fileName,
      totalBytes,
      uploadedBytes: completedBytes,
      percent: totalBytes > 0
        ? Math.round((completedBytes / totalBytes) * 100)
        : Math.round((completedParts / manifest.chunks.length) * 100),
      totalParts: manifest.chunks.length,
      completedParts,
      currentPart,
      statusText,
      parts: progressParts,
      cachedParts,
    })
  }

  emitReport('fetching', null, 'Preparing model chunks')

  const prefixEnd = Math.min(SEQUENTIAL_PREFIX_CHUNKS, manifest.chunks.length)
  for (let index = 0; index < prefixEnd; index += 1) {
    const part = progressParts[index]
    const chunkUrl = manifest.chunks[index]

    part.status = 'running'
    emitReport('fetching', index, `Loading part ${index + 1} of ${manifest.chunks.length} (priority)`)

    const result = await fetchChunk(chunkUrl, contentType)
    blobs[index] = result.blob
    part.status = 'done'
    part.cached = result.cached
    part.uploaded = result.blob.size || part.size
    part.size = result.blob.size || part.size
    part.percent = 100
    completedParts += 1
    completedBytes += part.uploaded
    if (result.cached) cachedParts += 1
    emitReport('fetching', index, result.cached
      ? `Loaded cached part ${index + 1}`
      : `Fetched part ${index + 1} of ${manifest.chunks.length}`)
  }

  nextIndex = prefixEnd

  const worker = async () => {
    while (nextIndex < manifest.chunks.length) {
      const index = nextIndex
      nextIndex += 1

      const part = progressParts[index]
      const chunkUrl = manifest.chunks[index]

      part.status = 'running'
      emitReport('fetching', index, `Fetching part ${index + 1} of ${manifest.chunks.length}`)

      try {
        const result = await fetchChunk(chunkUrl, contentType)
        blobs[index] = result.blob
        part.status = 'done'
        part.cached = result.cached
        part.uploaded = result.blob.size || part.size
        part.size = result.blob.size || part.size
        part.percent = 100
        completedParts += 1
        completedBytes += part.uploaded
        if (result.cached) cachedParts += 1
        emitReport('fetching', index, result.cached
          ? `Loaded cached part ${index + 1} of ${manifest.chunks.length}`
          : `Fetched part ${index + 1} of ${manifest.chunks.length}`)
      } catch (err) {
        part.status = 'error'
        emitReport('error', index, err.message)
        throw err
      }
    }
  }

  const remaining = manifest.chunks.length - prefixEnd
  if (remaining > 0) {
    await Promise.all(
      Array.from({ length: Math.min(CHUNK_FETCH_CONCURRENCY, remaining) }, () => worker()),
    )
  }

  emitReport('assembling', null, 'Combining model chunks')

  const blob = new Blob(blobs, { type: contentType })
  emitProgress(options.onProgress, 'done', {
    fileName,
    totalBytes: blob.size || totalBytes,
    uploadedBytes: blob.size || totalBytes,
    percent: 100,
    totalParts: manifest.chunks.length,
    completedParts: manifest.chunks.length,
    statusText: cachedParts > 0
      ? `Model ready (${cachedParts} cached parts)`
      : 'Model ready',
    parts: progressParts,
    cachedParts,
  })

  return blob
}

export async function fetchModelBlob(model, options = {}) {
  if (isChunkedModel(model)) return fetchChunkedModelBlob(model, options)

  const fixedUrl = normalizeStorageUrl(model?.url)
  if (!fixedUrl) throw new Error('Model is missing a URL.')

  options.onProgress?.({
    phase: 'fetching',
    fileName: model?.fileName || model?.path || 'model',
    totalBytes: model?.fileSize || 0,
    uploadedBytes: 0,
    percent: 0,
    totalParts: 1,
    completedParts: 0,
    currentPart: 0,
    statusText: 'Downloading model',
    parts: [{ index: 0, size: model?.fileSize || 0, uploaded: 0, percent: 0, status: 'running' }],
  })

  const res = await fetch(fixedUrl, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Could not load ${model?.fileName || model?.path || 'model'}`)

  const blob = await res.blob()
  options.onProgress?.({
    phase: 'done',
    fileName: model?.fileName || model?.path || 'model',
    totalBytes: blob.size,
    uploadedBytes: blob.size,
    percent: 100,
    totalParts: 1,
    completedParts: 1,
    currentPart: null,
    statusText: 'Model ready',
    parts: [{ index: 0, size: blob.size, uploaded: blob.size, percent: 100, status: 'done' }],
  })

  return blob
}

export async function createModelObjectUrl(model, options = {}) {
  if (!isChunkedModel(model)) {
    return { url: normalizeStorageUrl(model?.url), revoke: () => {} }
  }

  const blob = await fetchChunkedModelBlob(model, options)
  const url = URL.createObjectURL(blob)
  return {
    url,
    revoke: () => URL.revokeObjectURL(url),
  }
}
