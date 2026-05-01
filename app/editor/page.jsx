'use client'

import { useCallback, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
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
}

export default function EditorPage() {
  // ─── State ──────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState('upload') // 'upload' | 'processing' | 'ready'
  const [importResult, setImportResult] = useState(null)
  const [activePart, setActivePart] = useState(null)
  const [error, setError] = useState(null)
  const [sceneConfig, setSceneConfig] = useState({ ...DEFAULT_CONFIG })
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState(null) // { slug, embedCode, frameUrl }

  const interactionRef = useRef(new InteractionEngine())
  const modelFileRef = useRef(null) // Store the original file for publish upload

  // ─── File Upload → Pipeline ─────────────────────────────────────────────
  const handleFiles = useCallback(async (files) => {
    setPhase('processing')
    setError(null)
    // Store first model file for publish
    const modelEntry = files.find(f => f.file.name.endsWith('.glb') || f.file.name.endsWith('.gltf'))
    if (modelEntry) modelFileRef.current = modelEntry.file
    try {
      const result = await runImportPipeline(files)
      setImportResult(result)
      setPhase('ready')
    } catch (err) {
      setError(err.message)
      setPhase('upload')
    }
  }, [])

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
  const handlePublish = useCallback(async () => {
    if (!importResult || !modelFileRef.current) return

    setIsPublishing(true)
    try {
      const formData = new FormData()
      formData.append('model', modelFileRef.current)
      formData.append('name', importResult.file?.name?.replace(/\.\w+$/, '') || 'Untitled')
      formData.append('config', JSON.stringify({
        ...sceneConfig,
        parts: importResult.registry?.serialize?.() ?? [],
        import: {
          sourceUnit: importResult.normResult?.sourceUnit,
          sourceForward: importResult.normResult?.sourceForward,
        },
      }))

      const res = await fetch('/api/publish', { method: 'POST', body: formData })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Publish failed')

      setPublishResult({
        slug: json.slug,
        frameUrl: json.frameUrl,
        embedCode: json.embedCode,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setIsPublishing(false)
    }
  }, [importResult, sceneConfig])

  const handleReset = useCallback(() => {
    if (importResult?._blobUrls) {
      for (const url of importResult._blobUrls) URL.revokeObjectURL(url)
    }
    modelFileRef.current = null
    setImportResult(null)
    setPhase('upload')
    setActivePart(null)
    setError(null)
    setSceneConfig({ ...DEFAULT_CONFIG })
    setPublishResult(null)
  }, [importResult])

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
            <span style={{ color: 'var(--az-text-dim)', fontWeight: 400, fontSize: 13 }}>
              &nbsp;— {importResult.file.name}
            </span>
          )}
        </div>
        <div className='az-topbar-actions'>
          {isReady && (
            <>
              <button className='az-btn' onClick={handleReset}>↻ New</button>
              <button
                className='az-btn az-btn--primary'
                onClick={handlePublish}
                disabled={isPublishing}
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
          <div style={{ position: 'relative' }}>
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
          <div style={{ position: 'relative' }}>
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
                {window.location.origin}{publishResult.frameUrl}
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
    </div>
  )
}
