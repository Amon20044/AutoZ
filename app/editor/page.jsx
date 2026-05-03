'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, LoaderCircle, RotateCcw, Send } from 'lucide-react'
import * as THREE from 'three'

import ModelUploader from '@/components/dom/ModelUploader'
import ProcessingLog from '@/components/dom/ProcessingLog'
import PartDetectionPanel from '@/components/dom/PartDetectionPanel'
import EditorSettingsPanel from '@/components/dom/EditorSettingsPanel'
import { runImportPipeline } from '@/engine/pipeline/import-pipeline'
import { InteractionEngine } from '@/engine/core/interaction-engine'
import { fetchModelBlob, normalizeStorageUrl } from '@/lib/model/chunked-model'
import { optimizePublishModelFile } from '@/lib/model/optimize-publish-model'
import { DEFAULT_FRAME_CAMERA_SETTINGS } from '@/engine/math/camera'

// Dynamic import for the 3D viewer (no SSR)
const CarViewer = dynamic(
  () => import('@/components/canvas/CarViewer'),
  { ssr: false },
)

/** Default 3D scene config */
const DEFAULT_CONFIG = {
  environment: { preset: 'studio', background: false, backgroundColor: '#f7f7f4' },
  lighting: {
    intensity: 1,
    ambient: { enabled: true, color: '#ffffff', intensity: 0.42 },
    lights: [
      { type: 'directional', position: [4.5, 6.5, -4.5], intensity: 2.7, color: '#ffffff', castShadow: true, mapSize: 2048 },
      { type: 'directional', position: [-5, 3.5, 4], intensity: 0.9, color: '#dbeafe' },
      { type: 'directional', position: [0, 4.5, 6], intensity: 1.35, color: '#ffffff' },
    ],
  },
  fog: { enabled: false, color: '#f7f7f4', near: 8, far: 34 },
  stage: {
    backgroundColor: '#f7f7f4',
    shadows: true,
    radialFloorEnabled: true,
    radialFloorColor: '#9aa8bf',
    radialFloorOpacity: 0.42,
    radialFloorInner: 0.14,
    radialFloorOuter: 1.08,
    shadowOpacity: 0.52,
    shadowCatcherOpacity: 0.24,
    shadowBlur: 2.2,
    shadowFar: 8.5,
    shadowScale: 11,
    shadowResolution: 1024,
    shadowColor: '#1f2937',
    environmentIntensity: 1.18,
    backgroundIntensity: 0.75,
  },
  animation: { autoRotate: false, rotateSpeed: 0.35 },
  import: {},
  camera: { fov: 40, position: [5, 3, -7], frame: DEFAULT_FRAME_CAMERA_SETTINGS },
  postprocessing: {
    enabled: true,
    glare: 0.35,
    grain: 0.06,
    vignette: 0.16,
    exposure: 1.08,
    contrast: 1.08,
    saturation: 1.04,
    bloomThreshold: 0.62,
    bloomIntensity: 0.32,
    sharpness: 0.1,
    chromaticAberration: 0.0007,
  },
}

const DRAFT_PUBLISH_ID_STORAGE_KEY = 'autoz:draft-publish-id'

const TEXTURE_EXTENSIONS = new Set([
  'avif',
  'basis',
  'hdr',
  'jpeg',
  'jpg',
  'ktx',
  'ktx2',
  'png',
  'tga',
  'webp',
])

const PUBLISH_PROGRESS_STEPS = [
  { id: 'id', label: 'Checking URL ID' },
  { id: 'model', label: 'Uploading model' },
  { id: 'textures', label: 'Uploading textures' },
  { id: 'scene', label: 'Finalizing scene' },
  { id: 'ready', label: 'Ready to publish' },
]

const buildPublishProgress = (activeIndex = -1, failedIndex = -1) =>
  PUBLISH_PROGRESS_STEPS.map((step, index) => ({
    ...step,
    status: failedIndex === index
      ? 'error'
      : activeIndex === -1
        ? 'pending'
        : index < activeIndex
          ? 'done'
          : index === activeIndex
            ? 'running'
            : 'pending',
  }))

const isTextureFile = (file) => {
  const ext = file.name.split('.').pop()?.toLowerCase()
  return Boolean(ext && TEXTURE_EXTENSIONS.has(ext))
}

// Large model workaround: one Vercel-safe request per 3 MB file slice,
// followed by a small manifest.json that the frame viewer can rehydrate.
const LARGE_MODEL_CHUNK_SIZE = 3 * 1024 * 1024
const LARGE_MODEL_UPLOAD_CONCURRENCY = 4

function createUploadId() {
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : null
  return cryptoObj?.randomUUID?.() || `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function uploadModelPart({ file, slug, uploadId, partIndex, totalParts, start, end, onProgress }) {
  return new Promise((resolve, reject) => {
    const chunk = file.slice(start, end)
    const params = new URLSearchParams({
      slug,
      uploadId,
      fileName: file.name,
      fileSize: String(file.size),
      contentType: file.type || 'model/gltf-binary',
      partIndex: String(partIndex),
      totalParts: String(totalParts),
    })

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/publish/upload?${params}`, true)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({
          partIndex,
          totalParts,
          loaded: e.loaded,
          total: e.total,
        })
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('Upload succeeded but server returned invalid JSON.'))
        }
      } else {
        let errMsg = `Upload failed (HTTP ${xhr.status}).`
        try {
          const body = JSON.parse(xhr.responseText)
          if (body.error) errMsg = body.error
        } catch { /* ignore */ }
        reject(new Error(errMsg))
      }
    })

    xhr.addEventListener('error', () => {
      reject(new Error(`Network error uploading ${file.name}. Check your connection.`))
    })

    xhr.addEventListener('abort', () => {
      reject(new Error(`Upload of ${file.name} was aborted.`))
    })

    xhr.send(chunk)
  })
}

async function uploadChunkedModel(file, slug, uploadId, onProgress) {
  const totalParts = Math.ceil(file.size / LARGE_MODEL_CHUNK_SIZE)
  const parts = Array.from({ length: totalParts }, (_, index) => {
    const start = index * LARGE_MODEL_CHUNK_SIZE
    const end = Math.min(start + LARGE_MODEL_CHUNK_SIZE, file.size)

    return {
      index,
      size: end - start,
      uploaded: 0,
      percent: 0,
      status: 'pending',
    }
  })
  let completedBytes = 0

  const emit = (phase, extra = {}) => {
    const uploadedBytes = Math.min(
      file.size,
      completedBytes + parts
        .filter((part) => part.status === 'running')
        .reduce((sum, part) => sum + part.uploaded, 0),
    )
    const percent = file.size > 0 ? Math.round((uploadedBytes / file.size) * 100) : 0

    onProgress?.({
      phase,
      fileName: file.name,
      totalBytes: file.size,
      uploadedBytes,
      percent,
      totalParts,
      completedParts: parts.filter((part) => part.status === 'done').length,
      currentPart: extra.currentPart ?? null,
      statusText: extra.statusText ?? '',
      parts: parts.map((part) => ({ ...part })),
    })
  }

  emit('preparing', { statusText: `Preparing ${totalParts} upload parts` })

  let nextPartIndex = 0
  const uploadNextPart = async () => {
    while (nextPartIndex < totalParts) {
      const partIndex = nextPartIndex
      nextPartIndex += 1

      const start = partIndex * LARGE_MODEL_CHUNK_SIZE
      const end = Math.min(start + LARGE_MODEL_CHUNK_SIZE, file.size)
      const part = parts[partIndex]

      part.status = 'running'
      part.uploaded = 0
      part.percent = 0
      emit('uploading', {
        currentPart: partIndex,
        statusText: `Uploading ${Math.min(LARGE_MODEL_UPLOAD_CONCURRENCY, totalParts)} parts in parallel`,
      })

      try {
        await uploadModelPart({
          file,
          slug,
          uploadId,
          partIndex,
          totalParts,
          start,
          end,
          onProgress: ({ loaded, total }) => {
            part.uploaded = loaded
            part.percent = total > 0 ? Math.round((loaded / total) * 100) : 0
            emit('uploading', {
              currentPart: partIndex,
              statusText: `Uploading ${Math.min(LARGE_MODEL_UPLOAD_CONCURRENCY, totalParts)} parts in parallel`,
            })
          },
        })

        part.status = 'done'
        part.uploaded = part.size
        part.percent = 100
        completedBytes += part.size
        emit('uploading', {
          currentPart: partIndex,
          statusText: `Uploaded part ${partIndex + 1} of ${totalParts}`,
        })
      } catch (err) {
        part.status = 'error'
        emit('error', {
          currentPart: partIndex,
          statusText: err.message,
        })
        throw err
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(LARGE_MODEL_UPLOAD_CONCURRENCY, totalParts) }, () => uploadNextPart()),
  )

  emit('manifest', { statusText: 'Writing manifest.json' })

  const params = new URLSearchParams({
    mode: 'manifest',
    slug,
    uploadId,
    fileName: file.name,
    fileSize: String(file.size),
    contentType: file.type || 'model/gltf-binary',
    totalParts: String(totalParts),
  })
  const res = await fetch(`/api/publish/upload?${params}`, { method: 'POST' })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Could not finalize chunked model upload.')

  completedBytes = file.size
  emit('done', { statusText: 'Model upload complete' })
  return json
}

const mergeSceneConfigFromSnapshot = (snapshot = {}) => ({
  ...DEFAULT_CONFIG,
  environment: { ...DEFAULT_CONFIG.environment, ...(snapshot.environment ?? {}) },
  import: {
    ...(DEFAULT_CONFIG.import ?? {}),
    ...(snapshot.import ?? {}),
  },
  lighting: {
    ...DEFAULT_CONFIG.lighting,
    ...(snapshot.lighting ?? {}),
    ambient: { ...DEFAULT_CONFIG.lighting.ambient, ...(snapshot.lighting?.ambient ?? {}) },
    lights: snapshot.lighting?.lights ?? DEFAULT_CONFIG.lighting.lights,
  },
  fog: { ...DEFAULT_CONFIG.fog, ...(snapshot.fog ?? {}) },
  stage: {
    ...DEFAULT_CONFIG.stage,
    ...(snapshot.stage ?? {}),
    ...(snapshot.platform?.enabled === false ? { shadows: false } : {}),
  },
  animation: {
    ...DEFAULT_CONFIG.animation,
    ...(snapshot.animation ?? {}),
    ...(snapshot.platform ? {
      autoRotate: snapshot.platform.autoRotate ?? DEFAULT_CONFIG.animation.autoRotate,
      rotateSpeed: snapshot.platform.rotateSpeed ?? DEFAULT_CONFIG.animation.rotateSpeed,
    } : {}),
  },
  camera: { ...DEFAULT_CONFIG.camera, ...(snapshot.camera ?? {}) },
  postprocessing: { ...DEFAULT_CONFIG.postprocessing, ...(snapshot.postprocessing ?? {}) },
})

async function fetchSnapshotFileEntry({ model, url, path, fileName, onProgress }) {
  const blob = await fetchModelBlob(model ?? { url: normalizeStorageUrl(url), path, fileName }, { onProgress })
  const name = fileName || path?.split('/').pop() || 'asset'
  return {
    path: path || name,
    file: new File([blob], name, { type: blob.type || '' }),
  }
}

async function buildSnapshotFileEntries(snapshot, onModelProgress) {
  if (!snapshot.model?.url) return []

  const modelName = snapshot.model.fileName
    || snapshot.model.manifest?.fileName
    || snapshot.model.path?.split('/').pop()
    || 'model.glb'
  const modelPath = snapshot.model.chunked ? modelName : (snapshot.model.path || modelName)
  const entries = [
    await fetchSnapshotFileEntry({
      model: snapshot.model,
      url: snapshot.model.url,
      path: modelPath,
      fileName: modelName,
      onProgress: onModelProgress,
    }),
  ]

  const runtimeAssets = snapshot.runtimeAssets ?? []
  const runtimeEntries = await Promise.all(runtimeAssets
    .filter((asset) => asset.url && asset.path !== modelPath)
    .map((asset) => fetchSnapshotFileEntry({
      url: asset.url,
      path: asset.path,
      fileName: asset.originalName || asset.path?.split('/').pop(),
    })))

  entries.push(...runtimeEntries)
  return entries
}

export default function EditorPage({ initialPublishId = '' }) {
  const router = useRouter()
  // ─── State ──────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState('upload') // 'upload' | 'processing' | 'ready'
  const [importResult, setImportResult] = useState(null)
  const [activePart, setActivePart] = useState(null)
  const [error, setError] = useState(null)
  const [sceneConfig, setSceneConfig] = useState({ ...DEFAULT_CONFIG })
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishId, setPublishId] = useState('')
  const [publishIdError, setPublishIdError] = useState(null)
  const [isAllocatingPublishId, setIsAllocatingPublishId] = useState(true)
  const [isEditingExistingPublish, setIsEditingExistingPublish] = useState(Boolean(initialPublishId))
  const [publishProgress, setPublishProgress] = useState(() => buildPublishProgress())
  const [uploadProgress, setUploadProgress] = useState(null)
  const [publishResult, setPublishResult] = useState(null) // { slug, embedCode, frameUrl }
  const [toast, setToast] = useState(null)
  const [showPartLabels, setShowPartLabels] = useState(false)
  const [, setPartRevision] = useState(0)

  const interactionRef = useRef(new InteractionEngine())
  const modelFileRef = useRef(null) // Store the original file for publish upload
  const modelEntryRef = useRef(null)
  const droppedFilesRef = useRef([])
  const publishTimersRef = useRef([])

  const clearPublishTimers = useCallback(() => {
    publishTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    publishTimersRef.current = []
  }, [])

  const requestPublishId = useCallback(async ({ replaceStored = false } = {}) => {
    setIsAllocatingPublishId(true)
    setPublishIdError(null)

    try {
      if (!replaceStored) {
        const storedId = window.localStorage.getItem(DRAFT_PUBLISH_ID_STORAGE_KEY)
        if (storedId) {
          setPublishId(storedId)
          setIsAllocatingPublishId(false)
          return storedId
        }
      }

      const res = await fetch('/api/publish/id', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not create publish ID')

      window.localStorage.setItem(DRAFT_PUBLISH_ID_STORAGE_KEY, json.publishId)
      setPublishId(json.publishId)
      return json.publishId
    } catch (err) {
      setPublishIdError(err.message)
      return ''
    } finally {
      setIsAllocatingPublishId(false)
    }
  }, [])

  useEffect(() => {
    let active = true

    if (initialPublishId) {
      window.localStorage.setItem(DRAFT_PUBLISH_ID_STORAGE_KEY, initialPublishId)
      setPublishId(initialPublishId)
      setIsAllocatingPublishId(false)
      setIsEditingExistingPublish(true)
      return () => {
        active = false
        clearPublishTimers()
      }
    }

    requestPublishId().then((id) => {
      if (!active || !id) return
      setPublishId(id)
    })

    return () => {
      active = false
      clearPublishTimers()
    }
  }, [clearPublishTimers, initialPublishId, requestPublishId])

  const startPublishProgress = useCallback(() => {
    clearPublishTimers()
    setPublishProgress(buildPublishProgress(0))

    const schedule = (index, delay) => {
      const timer = window.setTimeout(() => {
        setPublishProgress(buildPublishProgress(index))
      }, delay)
      publishTimersRef.current.push(timer)
    }

    schedule(1, 250)
    schedule(2, 1100)
    schedule(3, 1900)
  }, [clearPublishTimers])

  const finishPublishProgress = useCallback(() => {
    clearPublishTimers()
    setPublishProgress(PUBLISH_PROGRESS_STEPS.map((step) => ({ ...step, status: 'done' })))
  }, [clearPublishTimers])

  const failPublishProgress = useCallback(() => {
    clearPublishTimers()
    setPublishProgress((steps) => {
      const runningIndex = Math.max(steps.findIndex((step) => step.status === 'running'), 0)
      return buildPublishProgress(runningIndex, runningIndex)
    })
  }, [clearPublishTimers])

  // ─── File Upload → Pipeline ─────────────────────────────────────────────
  const handleFiles = useCallback(async (files, options = {}) => {
    setPhase('processing')
    setError(null)
    setPublishResult(null)
    setPublishProgress(buildPublishProgress())
    if (!options.preserveTransferProgress) setUploadProgress(null)
    if (options.preserveTransferProgress) {
      setUploadProgress((prev) => prev ? {
        ...prev,
        phase: 'building',
        percent: 100,
        statusText: 'Rebuilding editable scene',
      } : prev)
    }
    droppedFilesRef.current = files
    modelFileRef.current = null
    modelEntryRef.current = null
    // Store first model file for publish
    const modelEntry = files.find((f) => {
      const name = f.file.name.toLowerCase()
      return name.endsWith('.glb') || name.endsWith('.gltf')
    })
    if (modelEntry) {
      modelFileRef.current = modelEntry.file
      modelEntryRef.current = modelEntry
    }
    try {
      const result = await runImportPipeline(files, options.importOptions ?? {})
      setImportResult(result)
      if (result?.normResult) {
        setSceneConfig((prev) => ({
          ...prev,
          import: { ...(prev.import ?? {}), ...result.normResult },
        }))
      }
      setPartRevision((value) => value + 1)
      setPhase('ready')
      if (options.preserveTransferProgress) {
        setUploadProgress((prev) => prev ? {
          ...prev,
          phase: 'done',
          percent: 100,
          statusText: 'Scene ready',
        } : prev)
      }
    } catch (err) {
      setError(err.message)
      setPhase('upload')
    }
  }, [])

  useEffect(() => {
    if (!initialPublishId) return undefined

    let active = true

      ; (async () => {
        try {
          setError(null)
          setPhase('processing')

          const res = await fetch(`/api/project/${initialPublishId}`, { cache: 'no-store' })
          const json = await res.json()
          if (!res.ok) throw new Error(json.error || 'Could not load saved project')

          const snapshot = json.publish.snapshot
          setSceneConfig(mergeSceneConfigFromSnapshot(snapshot))

        const entries = await buildSnapshotFileEntries(snapshot, setUploadProgress)
        if (!active) return

        if (entries.length > 0) {
          await handleFiles(entries, {
            preserveTransferProgress: true,
            importOptions: { parts: snapshot.parts ?? [] },
          })
          } else {
            setPhase('upload')
          }
        } catch (err) {
          if (!active) return
          setError(err.message)
          setPhase('upload')
        }
      })()

    return () => {
      active = false
    }
  }, [handleFiles, initialPublishId])

  // ─── Part Interactions ──────────────────────────────────────────────────
  const handlePartClick = useCallback((part) => {
    setActivePart(part.id)
    if (part.animationEnabled === false) return
    interactionRef.current.toggle(part.id)
  }, [])

  const handleToggle = useCallback((partId) => {
    const part = importResult?.registry?.get(partId)
    if (part?.animationEnabled === false) return
    interactionRef.current.toggle(partId)
    setActivePart(partId)
  }, [importResult])

  const handlePartConfigChange = useCallback((partId, patch) => {
    const part = interactionRef.current && importResult?.registry?.get(partId)
    if (!part) return

    if (Number.isFinite(patch.closeAngleDeg)) {
      part.closeAngle = THREE.MathUtils.degToRad(patch.closeAngleDeg)
    }
    if (Number.isFinite(patch.openAngleDeg)) {
      part.openAngle = THREE.MathUtils.degToRad(patch.openAngleDeg)
    }
    if (Number.isFinite(patch.spinSpeed)) {
      part.spinSpeed = patch.spinSpeed
      if ((part._spinSpeed ?? 0) !== 0) part._spinSpeed = patch.spinSpeed
    }
    if (typeof patch.animationEnabled === 'boolean') {
      part.animationEnabled = patch.animationEnabled
      if (!patch.animationEnabled) {
        part.targetState = part.defaultState
        part.currentState = part.defaultState
        part._spinSpeed = 0
      }
    }
    if (Array.isArray(patch.pivotOffset)) {
      const offset = new THREE.Vector3(
        Number.isFinite(patch.pivotOffset[0]) ? patch.pivotOffset[0] : 0,
        Number.isFinite(patch.pivotOffset[1]) ? patch.pivotOffset[1] : 0,
        Number.isFinite(patch.pivotOffset[2]) ? patch.pivotOffset[2] : 0,
      )
      part.pivotOffset = offset
      if (part.origin) part.pivot = part.origin.clone().add(offset)
      part.pivotSource = 'offset'
    }

    part._currentAngle = part.closeAngle
    setPartRevision((value) => value + 1)
  }, [importResult])

  // ─── Scene Config Updates ───────────────────────────────────────────────
  const handleConfigChange = useCallback((key, value) => {
    setSceneConfig((prev) => ({ ...prev, [key]: value }))
  }, [])

  // ─── Publish ────────────────────────────────────────────────────────────
  // Small files (<=3MB): included in the publish formData directly.
  // Larger files: uploaded as 3 MB objects + manifest.json, then the
  // publish API receives model metadata instead of the full file.

  const handlePublish = useCallback(async () => {
    if (!importResult || !modelFileRef.current) return

    setIsPublishing(true)
    setError(null)
    setPublishResult(null)
    setUploadProgress(null)

    // Step 0: Checking URL ID
    clearPublishTimers()
    setPublishProgress(buildPublishProgress(0))

    try {
      const activePublishId = publishId || await requestPublishId({ replaceStored: true })
      if (!activePublishId) {
        throw new Error('Publish ID is not ready yet. Please try again.')
      }

      // Step 1: Uploading model
      setPublishProgress(buildPublishProgress(1))

      const uploadId = createUploadId()
      const sourceModelFile = modelFileRef.current
      const optimized = await optimizePublishModelFile(sourceModelFile, {
        onProgress: setUploadProgress,
        options: { textureMode: 'ktx2', maxTextureSize: 2048 },
      })
      const modelFile = optimized.file
      const modelPath = optimized.optimized ? modelFile.name : (modelEntryRef.current?.path || modelFile.name)
      const isLargeFile = modelFile.size > LARGE_MODEL_CHUNK_SIZE

      let modelUploadMeta = null

      if (isLargeFile) {
        const uploadResult = await uploadChunkedModel(modelFile, activePublishId, uploadId, setUploadProgress)
        if (!uploadResult?.publicUrl) throw new Error('Upload proxy returned no URL.')

        modelUploadMeta = {
          modelUrl: uploadResult.publicUrl,
          modelKey: uploadResult.key,
          modelFileName: modelFile.name,
          modelFileSize: String(modelFile.size),
          modelIsChunked: 'true',
          modelManifest: JSON.stringify(uploadResult.manifest ?? {}),
        }
      }

      // Step 2: Uploading textures / resources
      setPublishProgress(buildPublishProgress(2))

      const resourceEntries = droppedFilesRef.current.filter((entry) => (
        entry.file !== modelFileRef.current
      ))
      const resourcePaths = resourceEntries.map((entry) => entry.path || entry.file.name)

      // Step 3: Finalizing scene (building formData + calling publish API)
      setPublishProgress(buildPublishProgress(3))

      // Build the full scene config including normalization data.
      // combinedScale, centerOffset, groundOffset, rotation are the exact values
      // used by applyNormalization() — storing them lets /frame replicate it exactly.
      const normResult = importResult.normResult ?? {}
      const configPayload = {
        ...sceneConfig,
        parts: importResult.registry?.serialize?.() ?? [],
        import: {
          // Fields used directly by applyNormalization in FrameCanvas:
          combinedScale: normResult.combinedScale ?? 1,
          centerOffset: normResult.centerOffset ?? [0, 0],    // [cx, cz]
          groundOffset: normResult.groundOffset ?? 0,
          rotation: normResult.rotation ?? { quaternion: [0, 0, 0, 1] },
          // Additional metadata for reference:
          scaleFactor: normResult.scaleFactor ?? 1,
          unitScale: normResult.unitScale ?? 1,
          dimensions: normResult.dimensions ?? {},
        },
      }

      const formData = new FormData()

      if (isLargeFile && modelUploadMeta) {
        // Large file path: model already on S3 — send metadata only
        formData.append('modelUrl', modelUploadMeta.modelUrl)
        formData.append('modelKey', modelUploadMeta.modelKey)
        formData.append('modelFileName', modelUploadMeta.modelFileName)
        formData.append('modelFileSize', modelUploadMeta.modelFileSize)
        formData.append('modelIsChunked', modelUploadMeta.modelIsChunked)
        formData.append('modelManifest', modelUploadMeta.modelManifest)
      } else {
        // Small file path: send file directly via formData
        formData.append('model', modelFile)
        formData.append('modelPath', modelPath)
      }

      formData.append('publishId', activePublishId)
      formData.append('uploadId', uploadId)
      formData.append('modelOptimization', JSON.stringify(optimized.metadata ?? {}))
      formData.append('updateExisting', isEditingExistingPublish ? 'true' : 'false')
      formData.append('name', importResult.file?.name?.replace(/\.\w+$/, '') || 'Untitled')
      formData.append('config', JSON.stringify(configPayload))
      formData.append('resourcePaths', JSON.stringify(resourcePaths))
      resourceEntries.forEach((entry) => {
        formData.append('resources', entry.file)
        if (isTextureFile(entry.file)) formData.append('textures', entry.file)
      })

      const res = await fetch('/api/publish', { method: 'POST', body: formData })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Publish failed')

      finishPublishProgress()
      setPublishId(json.slug)
      setIsEditingExistingPublish(true)
      window.localStorage.removeItem(DRAFT_PUBLISH_ID_STORAGE_KEY)
      router.replace(`/editor/${json.slug}`)
      setPublishResult({
        slug: json.slug,
        frameUrl: json.frameUrl,
        editorUrl: json.editorUrl,
        embedCode: json.embedCode,
      })
      setToast(`Published: ${json.frameUrl}`)
      setTimeout(() => setToast(null), 6000)
    } catch (err) {
      failPublishProgress()
      setUploadProgress((prev) => prev ? { ...prev, phase: 'error', statusText: err.message } : prev)
      setError(err.message)
    } finally {
      setIsPublishing(false)
    }
  }, [clearPublishTimers, failPublishProgress, finishPublishProgress, importResult, isEditingExistingPublish, publishId, requestPublishId, router, sceneConfig])

  const handleReset = useCallback(() => {
    if (importResult?._blobUrls) {
      for (const url of importResult._blobUrls) URL.revokeObjectURL(url)
    }
    modelFileRef.current = null
    modelEntryRef.current = null
    droppedFilesRef.current = []
    setImportResult(null)
    setPhase('upload')
    setActivePart(null)
    setError(null)
    setSceneConfig({ ...DEFAULT_CONFIG })
    setPublishProgress(buildPublishProgress())
    setUploadProgress(null)
    setPublishResult(null)
    setIsEditingExistingPublish(false)
    setPartRevision((value) => value + 1)
    router.replace('/editor')
    requestPublishId({ replaceStored: true })
  }, [importResult, requestPublishId, router])

  // ─── Derived ────────────────────────────────────────────────────────────
  const registry = importResult?.registry ?? null
  const parts = registry?.interactive ?? []
  const isReady = phase === 'ready' && importResult
  const mainClass = phase === 'upload'
    ? 'az-main az-main--upload'
    : isReady
      ? 'az-main az-main--ready'
      : 'az-main'

  return (
    <div className='az-editor'>
      {/* ─── Top Bar ──────────────────────────────────────────────────────── */}
      <div className='az-topbar'>
        <div className='az-topbar-brand'>
          <div className='az-topbar-brand-dot' />
          <span>AutoZ Engine</span>
          {importResult?.file && (
            <span className='az-topbar-file'>
              &nbsp;— {importResult.file.name}
            </span>
          )}
          <span className='az-topbar-id'>
            {isAllocatingPublishId ? 'ID creating...' : publishId ? `ID ${publishId}` : 'ID unavailable'}
          </span>
        </div>
        <div className='az-topbar-actions'>
          {isReady && (
            <>
              <button className='az-btn' onClick={handleReset}>
                <RotateCcw size={14} strokeWidth={2.2} aria-hidden='true' />
                <span>New</span>
              </button>
              <button
                className={`az-btn ${showPartLabels ? 'az-btn--active' : ''}`}
                onClick={() => setShowPartLabels((prev) => !prev)}
                title={showPartLabels ? 'Hide part labels' : 'Show part labels'}
              >
                {showPartLabels
                  ? <EyeOff size={14} strokeWidth={2.2} aria-hidden='true' />
                  : <Eye size={14} strokeWidth={2.2} aria-hidden='true' />}
                <span>{showPartLabels ? 'Hide Labels' : 'Show Labels'}</span>
              </button>
              <button
                className='az-btn az-btn--primary'
                onClick={handlePublish}
                disabled={isPublishing || isAllocatingPublishId}
              >
                {isPublishing
                  ? (
                    <>
                      <LoaderCircle size={14} strokeWidth={2.2} aria-hidden='true' className='az-icon-spin' />
                      <span>Publishing...</span>
                    </>
                  )
                  : (
                    <>
                      <Send size={14} strokeWidth={2.2} aria-hidden='true' />
                      <span>Publish</span>
                    </>
                  )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ─── Main Content ─────────────────────────────────────────────────── */}
      <div className={mainClass}>

        {/* Left Panel — shows during processing and ready */}
        {phase !== 'upload' && (
          <div className='az-panel-left'>
            {/* Processing Log */}
            <div className='az-panel-section'>
              <div className='az-panel-section-title'>Processing Log</div>
            </div>
            <div style={{ maxHeight: isReady ? '180px' : '50%', overflow: 'hidden', transition: 'max-height 500ms ease' }}>
              <ProcessingLog />
            </div>

            {/* Part Detection */}
            {isReady && (
              <>
                <div className='az-panel-section'>
                  <div className='az-panel-section-title'>
                    Detected Parts ({parts.length})
                  </div>
                </div>
                <PartDetectionPanel
                  parts={parts}
                  activePart={activePart}
                  onPartClick={(id) => {
                    setActivePart(id)
                    const part = registry.get(id)
                    if (part) handlePartClick(part)
                  }}
                  onToggle={handleToggle}
                  onPartConfigChange={handlePartConfigChange}
                />
              </>
            )}

            {/* Scene Stats */}
            {isReady && importResult.sceneStats && (
              <div className='az-panel-section' style={{ marginTop: 'auto' }}>
                <div className='az-panel-section-title'>Scene Info</div>
                <div style={{ fontSize: 11, fontFamily: 'var(--az-mono)', color: 'var(--az-text-dim)', lineHeight: 1.8 }}>
                  <div>Meshes: {importResult.sceneStats.meshCount}</div>
                  <div>Triangles: {Math.round(importResult.sceneStats.totalTris / 1000)}k</div>
                  <div>Vertices: {Math.round(importResult.sceneStats.totalVerts / 1000)}k</div>
                  <div>Materials: {importResult.sceneStats.uniqueMaterials}</div>
                  <div>Textures: {importResult.textures?.length ?? 0}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Center — upload zone OR 3D viewport */}
        {phase === 'upload' ? (
          <div className='az-center-stage'>
            <ModelUploader onFilesReady={handleFiles} />
            {error && (
              <div style={{
                position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
                padding: '10px 20px', borderRadius: 8,
                background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)',
                color: 'var(--az-error)', fontSize: 13, fontFamily: 'var(--az-font)',
                maxWidth: 480, textAlign: 'center',
              }}>
                {error}
              </div>
            )}
          </div>
        ) : (
          <div className='az-center-stage'>
            <CarViewer
              normalizedRoot={importResult?.normalizedRoot ?? null}
              registry={registry}
              interactionEngine={interactionRef.current}
              sceneStats={importResult?.sceneStats ?? null}
              sceneConfig={sceneConfig}
              onPartClick={handlePartClick}
              onToggle={handleToggle}
              showPartLabels={showPartLabels}
            />

            {/* Processing overlay */}
            {phase === 'processing' && (
              <div className='az-loading-overlay'>
                <div className='az-spinner' />
                <div style={{ fontSize: 14, color: 'var(--az-text-dim)' }}>
                  Processing model…
                </div>
                {uploadProgress && (
                  <div className='az-loading-progress'>
                    <div className='az-loading-progress-row'>
                      <span>{uploadProgress.statusText || 'Loading model'}</span>
                      <strong>{uploadProgress.percent ?? 0}%</strong>
                    </div>
                    <div className='az-progress-bar'>
                      <span style={{ width: `${Math.max(0, Math.min(100, uploadProgress.percent ?? 0))}%` }} />
                    </div>
                    <div className='az-loading-progress-meta'>
                      {(uploadProgress.completedParts ?? 0)} / {(uploadProgress.totalParts ?? 0)} parts
                      {uploadProgress.cachedParts ? `, ${uploadProgress.cachedParts} cached` : ''}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Right Panel — settings (only when ready) */}
        {isReady && (
          <EditorSettingsPanel
            config={sceneConfig}
            onChange={handleConfigChange}
            onPublish={handlePublish}
            isPublishing={isPublishing}
            publishId={publishId}
            publishIdError={publishIdError}
            isAllocatingPublishId={isAllocatingPublishId}
            publishProgress={publishProgress}
            uploadProgress={uploadProgress}
          />
        )}
      </div>

      {/* ─── Publish Success Dialog ───────────────────────────────────────── */}
      {publishResult && (
        <div className='az-publish-overlay' onClick={() => setPublishResult(null)}>
          <div className='az-publish-dialog' onClick={(e) => e.stopPropagation()}>
            <h2>🎉 Published!</h2>
            <p>
              Your 3D viewer is live. Share the embed code or open the link directly.
            </p>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--az-text-dim)', marginBottom: 6 }}>Frame URL</div>
              <div style={{
                padding: '8px 12px', background: 'rgba(0,0,0,0.3)',
                borderRadius: 6, fontSize: 12, fontFamily: 'var(--az-mono)', color: 'var(--az-text)',
                wordBreak: 'break-all'
              }}>
                {publishResult.frameUrl}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--az-text-dim)', marginBottom: 6 }}>Embed Code</div>
              <textarea
                className='az-embed-code'
                rows={3}
                readOnly
                value={publishResult.embedCode}
                onClick={(e) => e.target.select()}
              />
            </div>
            <div className='az-publish-actions'>
              <button className='az-btn' onClick={() => setPublishResult(null)}>Close</button>
              <a
                className='az-btn az-btn--primary'
                href={publishResult.frameUrl}
                target='_blank'
                rel='noopener noreferrer'
                style={{ textDecoration: 'none' }}
              >
                Open Viewer ↗
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Simple toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999 }}>
          <div style={{ background: 'rgba(34,197,94,0.95)', color: '#fff', padding: '10px 14px', borderRadius: 8, boxShadow: '0 6px 18px rgba(0,0,0,0.2)', fontFamily: 'var(--az-mono)' }}>
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}
