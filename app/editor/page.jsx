'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import './editor.css'

import ModelUploader from '@/components/dom/ModelUploader'
import ProcessingLog from '@/components/dom/ProcessingLog'
import PartDetectionPanel from '@/components/dom/PartDetectionPanel'
import EditorSettingsPanel from '@/components/dom/EditorSettingsPanel'
import { runImportPipeline } from '@/engine/pipeline/import-pipeline'
import { InteractionEngine } from '@/engine/core/interaction-engine'

// Dynamic import for the 3D viewer (no SSR)
const CarViewer = dynamic(
  () => import('@/components/canvas/CarViewer'),
  { ssr: false },
)

/** Default 3D scene config */
const DEFAULT_CONFIG = {
  environment: { preset: 'studio', background: false },
  lighting: {
    intensity: 1,
    ambient: { enabled: true, color: '#ffffff', intensity: 0.35 },
    lights: [
      { type: 'directional', position: [4, 6, -4], intensity: 2.2, color: '#ffffff', castShadow: true },
      { type: 'directional', position: [-4, 3, 3], intensity: 0.8, color: '#dbeafe' },
      { type: 'directional', position: [0, 4, 6], intensity: 1.1, color: '#ffffff' },
    ],
  },
  fog: { enabled: false, color: '#0a0a0f', near: 10, far: 50 },
  platform: { enabled: true, color: '#e0e0e0', autoRotate: true, rotateSpeed: 0.12, metalness: 0.92, roughness: 0.04, radius: 3 },
  camera: { fov: 40, position: [5, 3, -7] },
  postprocessing: { enabled: true, glare: 0.18, grain: 0.04, vignette: 0.2, exposure: 1.1, contrast: 1, saturation: 1 },
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

/**
 * Upload a file directly to S3 via a presigned PUT URL.
 * Uses XMLHttpRequest for upload progress tracking.
 *
 * @param {string} presignedUrl - The presigned PUT URL from the API.
 * @param {File} file - The file to upload.
 * @param {string} [fileName] - Display name for error messages.
 * @returns {Promise<void>}
 */
function uploadFileToPresignedUrl(presignedUrl, file, fileName) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', presignedUrl, true)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100)
        console.log(`[Upload] ${fileName || file.name}: ${pct}% (${(e.loaded / 1024 / 1024).toFixed(1)} / ${(e.total / 1024 / 1024).toFixed(1)} MB)`)
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(
          `Failed to upload ${fileName || file.name} to storage (HTTP ${xhr.status}). ` +
          'The file may be too large for the storage bucket limit, or the upload URL expired.',
        ))
      }
    })

    xhr.addEventListener('error', () => {
      reject(new Error(`Network error while uploading ${fileName || file.name}. Check your connection and try again.`))
    })

    xhr.addEventListener('abort', () => {
      reject(new Error(`Upload of ${fileName || file.name} was aborted.`))
    })

    xhr.send(file)
  })
}

const mergeSceneConfigFromSnapshot = (snapshot = {}) => ({
  ...DEFAULT_CONFIG,
  environment: { ...DEFAULT_CONFIG.environment, ...(snapshot.environment ?? {}) },
  lighting: {
    ...DEFAULT_CONFIG.lighting,
    ...(snapshot.lighting ?? {}),
    ambient: { ...DEFAULT_CONFIG.lighting.ambient, ...(snapshot.lighting?.ambient ?? {}) },
    lights: snapshot.lighting?.lights ?? DEFAULT_CONFIG.lighting.lights,
  },
  fog: { ...DEFAULT_CONFIG.fog, ...(snapshot.fog ?? {}) },
  platform: { ...DEFAULT_CONFIG.platform, ...(snapshot.platform ?? {}) },
  camera: { ...DEFAULT_CONFIG.camera, ...(snapshot.camera ?? {}) },
  postprocessing: { ...DEFAULT_CONFIG.postprocessing, ...(snapshot.postprocessing ?? {}) },
})

/**
 * Fix legacy snapshot URLs that were stored using the S3-compatible endpoint
 * (e.g. https://xxx.storage.supabase.co/storage/v1/s3/object/public/...)
 * Rewrite them to the correct Supabase Storage REST public URL format:
 *   https://xxx.supabase.co/storage/v1/object/public/...
 */
function normalizeStorageUrl(url) {
  try {
    const parsed = new URL(url)
    // Detect S3-endpoint URLs: hostname = *.storage.supabase.co, path includes /s3/
    if (
      parsed.hostname.endsWith('.storage.supabase.co') &&
      parsed.pathname.includes('/storage/v1/s3/')
    ) {
      // Rewrite hostname: xxx.storage.supabase.co → xxx.supabase.co
      parsed.hostname = parsed.hostname.replace('.storage.supabase.co', '.supabase.co')
      // Remove /s3 segment from path
      parsed.pathname = parsed.pathname.replace('/storage/v1/s3/', '/storage/v1/')
      return parsed.toString()
    }
  } catch {
    // If URL parsing fails, return as-is and let fetch handle the error
  }
  return url
}

async function fetchSnapshotFileEntry({ url, path, fileName }) {
  const fixedUrl = normalizeStorageUrl(url)
  const res = await fetch(fixedUrl)
  if (!res.ok) throw new Error(`Could not load ${fileName || path || 'asset'}`)

  const blob = await res.blob()
  const name = fileName || path?.split('/').pop() || 'asset'
  return {
    path: path || name,
    file: new File([blob], name, { type: blob.type || '' }),
  }
}

async function buildSnapshotFileEntries(snapshot) {
  if (!snapshot.model?.url) return []

  const modelPath = snapshot.model.path || snapshot.model.fileName || 'model.glb'
  const entries = [
    await fetchSnapshotFileEntry({
      url: snapshot.model.url,
      path: modelPath,
      fileName: snapshot.model.fileName || modelPath.split('/').pop(),
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
  const [publishResult, setPublishResult] = useState(null) // { slug, embedCode, frameUrl }
  const [toast, setToast] = useState(null)

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
  const handleFiles = useCallback(async (files) => {
    setPhase('processing')
    setError(null)
    setPublishResult(null)
    setPublishProgress(buildPublishProgress())
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
      const result = await runImportPipeline(files)
      setImportResult(result)
      setPhase('ready')
    } catch (err) {
      setError(err.message)
      setPhase('upload')
    }
  }, [])

  useEffect(() => {
    if (!initialPublishId) return undefined

    let active = true

    ;(async () => {
      try {
        setError(null)
        setPhase('processing')

        const res = await fetch(`/api/project/${initialPublishId}`, { cache: 'no-store' })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Could not load saved project')

        const snapshot = json.publish.snapshot
        setSceneConfig(mergeSceneConfigFromSnapshot(snapshot))

        const entries = await buildSnapshotFileEntries(snapshot)
        if (!active) return

        if (entries.length > 0) {
          await handleFiles(entries)
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
    interactionRef.current.toggle(part.id)
  }, [])

  const handleToggle = useCallback((partId) => {
    interactionRef.current.toggle(partId)
    setActivePart(partId)
  }, [])

  // ─── Scene Config Updates ───────────────────────────────────────────────
  const handleConfigChange = useCallback((key, value) => {
    setSceneConfig((prev) => ({ ...prev, [key]: value }))
  }, [])

  // ─── Publish ────────────────────────────────────────────────────────────
  // Threshold for switching to presigned URL upload (50 MB)
  const DIRECT_UPLOAD_LIMIT = 50 * 1024 * 1024

  const handlePublish = useCallback(async () => {
    if (!importResult || !modelFileRef.current) return

    setIsPublishing(true)
    setError(null)
    setPublishResult(null)

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

      const modelFile = modelFileRef.current
      const modelPath = modelEntryRef.current?.path || modelFile.name
      const isLargeFile = modelFile.size > DIRECT_UPLOAD_LIMIT

      let modelUploadMeta = null // { modelUrl, modelKey, modelFileName, modelFileSize }

      if (isLargeFile) {
        // ─── Large file: presigned URL upload directly to S3 ────────
        const urlRes = await fetch('/api/publish/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: activePublishId,
            fileName: modelPath,
            contentType: modelFile.type || 'model/gltf-binary',
          }),
        })
        const urlJson = await urlRes.json()
        if (!urlRes.ok) throw new Error(urlJson.error || 'Failed to get upload URL')

        // Upload directly to S3 using the presigned PUT URL
        await uploadFileToPresignedUrl(urlJson.uploadUrl, modelFile, urlJson.path)

        modelUploadMeta = {
          modelUrl: urlJson.publicUrl,
          modelKey: urlJson.key,
          modelFileName: modelFile.name,
          modelFileSize: String(modelFile.size),
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

      const formData = new FormData()

      if (isLargeFile && modelUploadMeta) {
        // Large file path: send model metadata instead of file
        formData.append('modelUrl', modelUploadMeta.modelUrl)
        formData.append('modelKey', modelUploadMeta.modelKey)
        formData.append('modelFileName', modelUploadMeta.modelFileName)
        formData.append('modelFileSize', modelUploadMeta.modelFileSize)
      } else {
        // Small file path: send file directly
        formData.append('model', modelFile)
        formData.append('modelPath', modelPath)
      }

      formData.append('publishId', activePublishId)
      formData.append('updateExisting', isEditingExistingPublish ? 'true' : 'false')
      formData.append('name', importResult.file?.name?.replace(/\.\w+$/, '') || 'Untitled')
      formData.append('config', JSON.stringify({
        ...sceneConfig,
        parts: importResult.registry?.serialize?.() ?? [],
        import: {
          sourceUnit: importResult.normResult?.sourceUnit,
          sourceForward: importResult.normResult?.sourceForward,
        },
      }))
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
      // show a short toast confirming publish and copy-ready URL
      setToast(`Published: ${json.frameUrl}`)
      setTimeout(() => setToast(null), 6000)
    } catch (err) {
      failPublishProgress()
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
    setPublishResult(null)
    setIsEditingExistingPublish(false)
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
              <button className='az-btn' onClick={handleReset}>↻ New</button>
              <button
                className='az-btn az-btn--primary'
                onClick={handlePublish}
                disabled={isPublishing || isAllocatingPublishId}
              >
                {isPublishing ? '⏳ Publishing…' : '🚀 Publish'}
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
            />

            {/* Processing overlay */}
            {phase === 'processing' && (
              <div className='az-loading-overlay'>
                <div className='az-spinner' />
                <div style={{ fontSize: 14, color: 'var(--az-text-dim)' }}>
                  Processing model…
                </div>
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
