'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Check, LoaderCircle, RotateCcw, Save } from 'lucide-react'
import * as THREE from 'three'

import ProcessingLog from '@/components/dom/ProcessingLog'
import PartDetectionPanel from '@/components/dom/PartDetectionPanel'
import EditorSettingsPanel from '@/components/dom/EditorSettingsPanel'
import { runImportPipeline } from '@/engine/pipeline/import-pipeline'
import { InteractionEngine } from '@/engine/core/interaction-engine'
import { DEFAULT_FRAME_CAMERA_SETTINGS } from '@/engine/math/camera'

const CarViewer = dynamic(() => import('@/components/canvas/CarViewer'), { ssr: false })

const DEMO_MODEL_URL = '/Fortuner-compressed.glb'
const DEMO_MODEL_NAME = 'Fortuner-compressed.glb'

const DEFAULT_DEMO_CONFIG = {
  environment: { preset: 'studio', background: false, backgroundColor: '#0b0e14' },
  lighting: {
    intensity: 1,
    ambient: { enabled: true, color: '#ffffff', intensity: 0.42 },
    lights: [
      { type: 'directional', position: [4.5, 6.5, -4.5], intensity: 2.7, color: '#ffffff', castShadow: true, mapSize: 2048 },
      { type: 'directional', position: [-5, 3.5, 4], intensity: 0.9, color: '#dbeafe' },
      { type: 'directional', position: [0, 4.5, 6], intensity: 1.35, color: '#ffffff' },
    ],
  },
  fog: { enabled: false, color: '#0b0e14', near: 8, far: 34 },
  stage: {
    backgroundColor: '#0b0e14',
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
  animation: { autoRotate: true, rotateSpeed: 0.32 },
  import: {},
  camera: { fov: 40, position: [5, 3, -7], frame: DEFAULT_FRAME_CAMERA_SETTINGS },
  postprocessing: {
    enabled: true,
    glare: 0.35,
    grain: 0.06,
    vignette: 0.18,
    exposure: 1.08,
    contrast: 1.08,
    saturation: 1.04,
    bloomThreshold: 0.62,
    bloomIntensity: 0.32,
    sharpness: 0.1,
    chromaticAberration: 0.0007,
  },
}

function mergeSceneConfig(snapshot = {}) {
  return {
    ...DEFAULT_DEMO_CONFIG,
    environment: { ...DEFAULT_DEMO_CONFIG.environment, ...(snapshot.environment ?? {}) },
    lighting: {
      ...DEFAULT_DEMO_CONFIG.lighting,
      ...(snapshot.lighting ?? {}),
      ambient: { ...DEFAULT_DEMO_CONFIG.lighting.ambient, ...(snapshot.lighting?.ambient ?? {}) },
      lights: snapshot.lighting?.lights ?? DEFAULT_DEMO_CONFIG.lighting.lights,
    },
    fog: { ...DEFAULT_DEMO_CONFIG.fog, ...(snapshot.fog ?? {}) },
    stage: { ...DEFAULT_DEMO_CONFIG.stage, ...(snapshot.stage ?? {}) },
    animation: { ...DEFAULT_DEMO_CONFIG.animation, ...(snapshot.animation ?? {}) },
    camera: { ...DEFAULT_DEMO_CONFIG.camera, ...(snapshot.camera ?? {}) },
    postprocessing: { ...DEFAULT_DEMO_CONFIG.postprocessing, ...(snapshot.postprocessing ?? {}) },
    import: snapshot.import ?? {},
  }
}

export default function DemoEditorClient() {
  const interactionRef = useRef(new InteractionEngine())

  const [phase, setPhase] = useState('loading') // 'loading' | 'ready' | 'error'
  const [importResult, setImportResult] = useState(null)
  const [activePart, setActivePart] = useState(null)
  const [sceneConfig, setSceneConfig] = useState({ ...DEFAULT_DEMO_CONFIG })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [, setPartRevision] = useState(0)
  const snapshotRef = useRef(null)

  // ─── Boot: load GLB + saved demo config ────────────────────────────────
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      setPhase('loading')
      setError(null)

      try {
        const [configRes, modelRes] = await Promise.all([
          fetch('/api/demo/config', { cache: 'no-store' }),
          fetch(DEMO_MODEL_URL),
        ])
        if (!configRes.ok) throw new Error(`Demo config ${configRes.status}`)
        if (!modelRes.ok) throw new Error(`Could not load ${DEMO_MODEL_URL} (${modelRes.status}).`)

        const configJson = await configRes.json()
        const snapshot = configJson.config ?? {}
        snapshotRef.current = snapshot

        const blob = await modelRes.blob()
        const file = new File([blob], DEMO_MODEL_NAME, { type: blob.type || 'model/gltf-binary' })
        const entry = { path: DEMO_MODEL_NAME, file }

        const result = await runImportPipeline([entry], { parts: snapshot.parts ?? [] })
        if (cancelled) return

        setImportResult(result)
        setSceneConfig(mergeSceneConfig({
          ...snapshot,
          import: {
            ...(snapshot.import ?? {}),
            ...(result?.normResult ?? {}),
          },
        }))
        setPartRevision((value) => value + 1)
        setPhase('ready')
      } catch (err) {
        if (cancelled) return
        setError(err.message || String(err))
        setPhase('error')
      }
    })()

    return () => { cancelled = true }
  }, [])

  // ─── Part interactions ──────────────────────────────────────────────────
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
    const part = importResult?.registry?.get(partId)
    if (!part) return

    if (Number.isFinite(patch.closeAngleDeg)) part.closeAngle = THREE.MathUtils.degToRad(patch.closeAngleDeg)
    if (Number.isFinite(patch.openAngleDeg)) part.openAngle = THREE.MathUtils.degToRad(patch.openAngleDeg)
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

  const handleConfigChange = useCallback((key, value) => {
    setSceneConfig((prev) => ({ ...prev, [key]: value }))
  }, [])

  // ─── Save demo config ──────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!importResult) return
    setSaving(true)
    setError(null)
    setToast(null)

    try {
      const normResult = importResult.normResult ?? {}
      const previousSnapshot = snapshotRef.current ?? {}
      const nextConfig = {
        ...previousSnapshot,
        ...sceneConfig,
        version: previousSnapshot.version ?? 1,
        slug: previousSnapshot.slug ?? 'demo-landing',
        model: previousSnapshot.model ?? {
          url: DEMO_MODEL_URL,
          fileName: DEMO_MODEL_NAME,
          path: DEMO_MODEL_NAME,
          contentType: 'model/gltf-binary',
        },
        runtimeAssets: previousSnapshot.runtimeAssets ?? [],
        thumbnail: previousSnapshot.thumbnail ?? null,
        textureAssets: previousSnapshot.textureAssets ?? [],
        materials: previousSnapshot.materials ?? [],
        assetManifest: previousSnapshot.assetManifest ?? null,
        branding: previousSnapshot.branding ?? { watermark: true, text: 'made in AutoZ' },
        performance: previousSnapshot.performance ?? { preset: 'high' },
        parts: importResult.registry?.serialize?.() ?? previousSnapshot.parts ?? [],
        import: {
          combinedScale: normResult.combinedScale ?? 1,
          centerOffset: normResult.centerOffset ?? [0, 0],
          groundOffset: normResult.groundOffset ?? 0,
          rotation: normResult.rotation ?? { quaternion: [0, 0, 0, 1] },
          scaleFactor: normResult.scaleFactor ?? 1,
          unitScale: normResult.unitScale ?? 1,
          dimensions: normResult.dimensions ?? {},
          boundingBoxNormalized: normResult.boundingBoxNormalized ?? previousSnapshot.import?.boundingBoxNormalized,
        },
      }

      const res = await fetch('/api/demo/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: nextConfig }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `Save failed (${res.status}).`)

      snapshotRef.current = json.config ?? nextConfig
      try {
        window.localStorage.removeItem('autoz:demo-config:v1')
      } catch { /* ignore */ }
      setToast(`Saved → ${json.file || 'public/demo/demo-config.json'} · commit + push to deploy`)
      setTimeout(() => setToast(null), 6000)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setSaving(false)
    }
  }, [importResult, sceneConfig])

  const handleResetScene = useCallback(() => {
    setSceneConfig((prev) => ({
      ...DEFAULT_DEMO_CONFIG,
      camera: { ...DEFAULT_DEMO_CONFIG.camera },
      import: prev.import,
    }))
  }, [])

  // ─── Render ─────────────────────────────────────────────────────────────
  const registry = importResult?.registry ?? null
  const parts = registry?.interactive ?? []
  const isReady = phase === 'ready' && importResult

  return (
    <div className='az-editor'>
      <div className='az-topbar'>
        <div className='az-topbar-brand'>
          <div className='az-topbar-brand-dot' />
          <span>AutoZ Engine</span>
          <span className='az-topbar-file'>&nbsp;— Demo (Fortuner)</span>
          <span className='az-topbar-id az-topbar-id--demo'>Demo edit · localhost only</span>
        </div>
        <div className='az-topbar-actions'>
          <button className='az-btn' onClick={handleResetScene} disabled={!isReady}>
            <RotateCcw size={14} strokeWidth={2.2} aria-hidden='true' />
            <span>Reset scene</span>
          </button>
          <button
            className='az-btn az-btn--primary'
            onClick={handleSave}
            disabled={!isReady || saving}
            title='Writes public/demo/demo-config.json — commit + push to deploy.'
          >
            {saving
              ? (<><LoaderCircle size={14} strokeWidth={2.2} className='az-icon-spin' aria-hidden='true' /> <span>Saving…</span></>)
              : (<><Save size={14} strokeWidth={2.2} aria-hidden='true' /> <span>Generate config</span></>)}
          </button>
        </div>
      </div>

      <div className={isReady ? 'az-main az-main--ready' : 'az-main'}>
        <div className='az-panel-left'>
          <div className='az-panel-section'>
            <div className='az-panel-section-title'>Processing Log</div>
          </div>
          <div style={{ maxHeight: isReady ? '180px' : '50%', overflow: 'hidden', transition: 'max-height 500ms ease' }}>
            <ProcessingLog />
          </div>
          {isReady && (
            <>
              <div className='az-panel-section'>
                <div className='az-panel-section-title'>Detected Parts ({parts.length})</div>
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
        </div>

        <div className='az-center-stage'>
          {isReady ? (
            <CarViewer
              normalizedRoot={importResult?.normalizedRoot ?? null}
              registry={registry}
              interactionEngine={interactionRef.current}
              sceneStats={importResult?.sceneStats ?? null}
              sceneConfig={sceneConfig}
              onPartClick={handlePartClick}
              onToggle={handleToggle}
              showPartLabels={false}
              activePartId={activePart}
            />
          ) : (
            <div className='az-loading-overlay'>
              <div className='az-spinner' />
              <div style={{ fontSize: 14, color: 'var(--az-text-dim)' }}>
                {phase === 'error' ? 'Could not load demo' : 'Loading demo model…'}
              </div>
              {error && (
                <div style={{ color: 'var(--az-error)', fontSize: 12, fontFamily: 'var(--az-mono)', maxWidth: 420, textAlign: 'center' }}>
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {isReady && (
          <EditorSettingsPanel
            config={sceneConfig}
            onChange={handleConfigChange}
            onPublish={handleSave}
            isPublishing={saving}
            publishId={'demo-landing'}
            publishIdError={null}
            isAllocatingPublishId={false}
            publishProgress={[]}
            uploadProgress={null}
          />
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999 }}>
          <div style={{
            background: 'rgba(34,197,94,0.95)', color: '#fff',
            padding: '10px 14px', borderRadius: 8,
            boxShadow: '0 6px 18px rgba(0,0,0,0.2)',
            fontFamily: 'var(--font-mono)', display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            <Check size={14} aria-hidden='true' /> {toast}
          </div>
        </div>
      )}
    </div>
  )
}
