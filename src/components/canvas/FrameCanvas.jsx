'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  OrbitControls, PerspectiveCamera, AdaptiveDpr, useGLTF,
} from '@react-three/drei'
import * as THREE from 'three'
import { Camera, Disc3, Eye, EyeOff, Lightbulb } from 'lucide-react'
import PostProcessing, { RendererSettings } from './PostProcessing'
import PartButtons from './PartButtons'
import StudioStage from './StudioStage'
import ImperativeMeshPicker from './ImperativeMeshPicker'
import { useAutoZEngine } from '@/engine/hooks/useAutoZEngine'
import {
  createModelObjectUrl,
  isChunkedModel,
  normalizeStorageUrl,
} from '@/lib/model/chunked-model'
import { orbitTargetFromImport } from '@/lib/scene/orbit-target'
import { installThreeConsoleFilter } from '@/lib/three/console-filter'
import { useDeviceProfile } from '@/hooks/useDeviceProfile'
import { computeFrameCameraPreset, FRAME_CAMERA_MODES } from '@/engine/math/camera'
import { dampVec3, stableDelta } from '@/engine/math/animation'

installThreeConsoleFilter()

/**
 * Lightweight frame viewer canvas with grouped runtime controls.
 * @param {{ snapshot: object }} props
 */
export default function FrameCanvas({ snapshot }) {
  const fog = snapshot.fog ?? {}
  const cam = snapshot.camera ?? {}
  const post = snapshot.postprocessing ?? {}
  const environment = snapshot.environment ?? { preset: 'studio', background: false, backgroundColor: '#f7f7f4' }
  const stage = getStageConfig(snapshot)
  const backgroundColor = stage.backgroundColor ?? environment.backgroundColor ?? '#f7f7f4'
  const orbitTarget = useMemo(
    () => orbitTargetFromImport(snapshot.import, [0, 0.8, 0]),
    [snapshot.import],
  )
  const [runtime, setRuntime] = useState({ engine: null, registry: null })
  const [lightsOn, setLightsOn] = useState(false)
  const [wheelsOn, setWheelsOn] = useState(false)
  const [wheelSpeed, setWheelSpeed] = useState(5.5)
  const [modelLoadProgress, setModelLoadProgress] = useState(null)
  const [modelLoadError, setModelLoadError] = useState(null)
  const [modelReady, setModelReady] = useState(false)
  const [showPartLabels, setShowPartLabels] = useState(false)
  const [cameraMode, setCameraMode] = useState('auto')
  const [frameInfo, setFrameInfo] = useState(null)
  const controlsRef = useRef(null)

  const lightCount = runtime.registry?.headLights.length || runtime.registry?.lights.length || 0
  const wheelCount = runtime.registry?.wheelSpinParts.length ?? 0

  useEffect(() => {
    setModelLoadError(null)
  }, [snapshot?.slug])

  const handleRuntimeReady = useCallback((nextRuntime) => {
    setRuntime(nextRuntime)
    setModelReady(Boolean(nextRuntime?.engine && nextRuntime?.registry))
    setFrameInfo(nextRuntime?.engine?.getFrameInfo?.() ?? null)
    const savedSpeed = nextRuntime?.registry?.wheelSpinParts?.find((part) => Number.isFinite(part.spinSpeed))?.spinSpeed
    if (Number.isFinite(savedSpeed)) setWheelSpeed(savedSpeed)
  }, [])

  const toggleLights = useCallback(() => {
    const next = !lightsOn
    const applied = runtime.engine?.toggleHeadlights(next)
    if (applied !== false) setLightsOn(next)
  }, [lightsOn, runtime.engine])

  const toggleWheels = useCallback(() => {
    const next = !wheelsOn
    const applied = runtime.engine?.setWheelSpin(next, wheelSpeed)
    if (applied !== false) setWheelsOn(next)
  }, [runtime.engine, wheelSpeed, wheelsOn])

  const handleWheelSpeedChange = useCallback((value) => {
    setWheelSpeed(value)
    if (wheelsOn) runtime.engine?.setWheelSpin(true, value)
  }, [runtime.engine, wheelsOn])

  return (
    <div className='frame-canvas-shell'>
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        gl={{
          antialias: true,
          toneMapping: THREE.AgXToneMapping,
          toneMappingExposure: post.exposure ?? 1.1,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        dpr={[1, 2]}
        style={{ background: backgroundColor, width: '100%', height: '100%' }}
      >
        <PerspectiveCamera
          makeDefault
          fov={cam.fov ?? 40}
          near={0.01}
          far={100}
          position={cam.position ?? [5, 3, -7]}
        />
        <RendererSettings exposure={post.exposure ?? 1.1} />

        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.1}
          minPolarAngle={0.3}
          maxPolarAngle={Math.PI / 2 - 0.05}
          minDistance={2}
          maxDistance={12}
          enablePan={false}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }}
          target={orbitTarget}
          autoRotate={cameraMode === 'auto'}
          autoRotateSpeed={snapshot.animation?.rotateSpeed ?? 0.35}
        />

        <FrameCameraRig
          mode={cameraMode}
          controlsRef={controlsRef}
          frameInfo={frameInfo}
          fallbackTarget={orbitTarget}
          snapshot={snapshot}
        />

        <AdaptiveDpr />
        <StudioStage environment={environment} stage={stage} fog={fog} />

        <Suspense fallback={null}>
          {snapshot.model?.url && (
            <FrameRuntimeLoader
              snapshot={snapshot}
              onReady={handleRuntimeReady}
              onProgress={setModelLoadProgress}
              onError={setModelLoadError}
              showPartLabels={showPartLabels}
            />
          )}
        </Suspense>

        <ImperativeMeshPicker
          enabled={Boolean(runtime.engine && runtime.registry)}
          getRoots={() => [runtime.engine?._modelRoot].filter(Boolean)}
          onMesh={(mesh) => {
            const engine = runtime.engine
            if (!engine) return false
            // engine.onMeshClick toggles matching part
            const part = engine.onMeshClick(mesh)
            return Boolean(part)
          }}
        />

        {post.enabled !== false && <PostProcessing config={post} />}
      </Canvas>

      {modelLoadError && snapshot.model?.url && (
        <div className='frame-loading frame-loading--error' role='alert'>
          <div>{modelLoadError}</div>
        </div>
      )}

      {!modelReady && snapshot.model?.url && !modelLoadError && (
        <div className='frame-loading'>
          <div className='az-spinner' />
          <div>{modelLoadProgress?.statusText || 'Loading model'}</div>
          {modelLoadProgress && (
            <div className='frame-load-progress'>
              <div className='frame-load-progress-row'>
                <span>{modelLoadProgress.completedParts ?? 0} / {modelLoadProgress.totalParts ?? 0} parts</span>
                <strong>{modelLoadProgress.percent ?? 0}%</strong>
              </div>
              <div className='az-progress-bar'>
                <span style={{ width: `${Math.max(0, Math.min(100, modelLoadProgress.percent ?? 0))}%` }} />
              </div>
              {modelLoadProgress.cachedParts ? (
                <div className='frame-load-progress-meta'>{modelLoadProgress.cachedParts} cached</div>
              ) : null}
            </div>
          )}
        </div>
      )}

      <div className='frame-controls' aria-label='Vehicle controls'>
        <label className='frame-camera-control' title='Camera angle'>
          <span className='frame-control-icon'>
            <Camera size={13} strokeWidth={2.3} aria-hidden='true' />
          </span>
          <select
            value={cameraMode}
            onChange={(e) => setCameraMode(e.target.value)}
            aria-label='Camera angle'
          >
            {FRAME_CAMERA_MODES.map((mode) => (
              <option key={mode.id} value={mode.id}>{mode.label}</option>
            ))}
          </select>
        </label>
        <button
          type='button'
          className={`frame-control ${lightsOn ? 'frame-control--active' : ''}`}
          onClick={toggleLights}
          disabled={!runtime.engine || lightCount === 0}
          title={lightCount > 0 ? 'Toggle headlights' : 'No headlights detected'}
        >
          <span className='frame-control-icon'>
            <Lightbulb size={13} strokeWidth={2.3} aria-hidden='true' />
          </span>
          <span>Headlights</span>
        </button>
        <button
          type='button'
          className={`frame-control ${wheelsOn ? 'frame-control--active' : ''}`}
          onClick={toggleWheels}
          disabled={!runtime.engine || wheelCount === 0}
          title={wheelCount > 0 ? 'Toggle wheel spin' : 'No wheels detected'}
        >
          <span className='frame-control-icon'>
            <Disc3 size={13} strokeWidth={2.3} aria-hidden='true' />
          </span>
          <span>Wheel Spin</span>
        </button>
        <label className='frame-speed-control' title='Wheel spin speed'>
          <span>{wheelSpeed.toFixed(1)}x</span>
          <input
            type='range'
            min='0.5'
            max='14'
            step='0.5'
            value={wheelSpeed}
            disabled={!runtime.engine || wheelCount === 0}
            onChange={(e) => handleWheelSpeedChange(parseFloat(e.target.value))}
          />
        </label>
        <button
          type='button'
          className={`frame-control ${showPartLabels ? 'frame-control--active' : ''}`}
          onClick={() => setShowPartLabels((prev) => !prev)}
          disabled={!runtime.engine}
          title={showPartLabels ? 'Hide part labels' : 'Show part labels'}
        >
          <span className='frame-control-icon'>
            {showPartLabels
              ? <EyeOff size={13} strokeWidth={2.3} aria-hidden='true' />
              : <Eye size={13} strokeWidth={2.3} aria-hidden='true' />}
          </span>
          <span>{showPartLabels ? 'Hide Labels' : 'Show Labels'}</span>
        </button>
      </div>
    </div>
  )
}

function getStageConfig(snapshot) {
  const s = snapshot.stage ?? {}
  return {
    backgroundColor: s.backgroundColor ?? snapshot.environment?.backgroundColor ?? '#f7f7f4',
    shadows: s.shadows ?? snapshot.platform?.enabled ?? true,
    radialFloorEnabled: s.radialFloorEnabled !== undefined ? s.radialFloorEnabled : true,
    radialFloorColor: s.radialFloorColor ?? '#9aa8bf',
    radialFloorOpacity: s.radialFloorOpacity ?? 0.42,
    radialFloorInner: s.radialFloorInner ?? 0.14,
    radialFloorOuter: s.radialFloorOuter ?? 1.08,
    shadowOpacity: s.shadowOpacity ?? 0.34,
    shadowBlur: s.shadowBlur ?? 2.8,
    shadowFar: s.shadowFar ?? 7.5,
    shadowScale: s.shadowScale ?? 11,
    shadowResolution: s.shadowResolution ?? 1024,
    shadowColor: s.shadowColor ?? '#475569',
    environmentIntensity: s.environmentIntensity ?? 1.18,
    backgroundIntensity: s.backgroundIntensity ?? 0.75,
  }
}

function getFrameAssetManifest(snapshot) {
  return snapshot.assetManifest
    ?? snapshot.model?.assetManifest
    ?? snapshot.assets?.assetManifest
    ?? null
}

function FrameCameraRig({
  mode, controlsRef, frameInfo, fallbackTarget, snapshot,
}) {
  const { camera, size } = useThree()
  const desired = useRef({
    position: new THREE.Vector3(...(snapshot.camera?.position ?? [5, 3, -7])),
    target: new THREE.Vector3(...fallbackTarget),
    minDistance: 2,
    maxDistance: 12,
    autoRotate: mode === 'auto',
  })
  const previousMode = useRef(mode)
  const autoSettleUntil = useRef(0)

  useEffect(() => {
    const isMobile = size.width <= 720 || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)
    const preset = computeFrameCameraPreset({
      mode,
      frameInfo,
      fovDeg: snapshot.camera?.fov ?? 40,
      aspect: size.width / Math.max(size.height, 1),
      isMobile,
    })

    desired.current.position.fromArray(preset.position)
    desired.current.target.fromArray(preset.target)
    desired.current.minDistance = preset.minDistance
    desired.current.maxDistance = preset.maxDistance
    desired.current.autoRotate = preset.autoRotate

    const controls = controlsRef.current
    if (controls) {
      controls.minDistance = preset.minDistance
      controls.maxDistance = preset.maxDistance
      controls.autoRotate = preset.autoRotate
      controls.enablePan = false
    }

    if (previousMode.current !== mode && mode === 'auto') {
      autoSettleUntil.current = performance.now() + 900
    } else if (previousMode.current !== mode) {
      autoSettleUntil.current = 0
    }
    previousMode.current = mode
  }, [controlsRef, fallbackTarget, frameInfo, mode, size.height, size.width, snapshot.camera?.fov])

  useFrame((_, rawDt) => {
    const dt = stableDelta(rawDt)
    const controls = controlsRef.current
    const target = desired.current.target
    const position = desired.current.position
    const smoothness = mode === 'cockpit' ? 12 : 8.5
    const isSettlingAuto = mode === 'auto' && performance.now() < autoSettleUntil.current

    if (controls) {
      dampVec3(controls.target, target, 10, dt)
      controls.minDistance = desired.current.minDistance
      controls.maxDistance = desired.current.maxDistance
      controls.autoRotate = desired.current.autoRotate
    }

    if (mode !== 'auto' || isSettlingAuto) {
      dampVec3(camera.position, position, smoothness, dt)
    }

    const radius = Math.max(frameInfo?.radius ?? 4, 1)
    camera.near = Math.max(0.01, camera.position.distanceTo(target) - radius * 2.25)
    camera.far = Math.max(80, camera.position.distanceTo(target) + radius * 6)
    camera.updateProjectionMatrix()
  })

  return null
}

function isStandaloneGltfUrl(raw) {
  if (!raw || typeof raw !== 'string') return false
  const u = raw.toLowerCase()
  if (u.includes('manifest.json')) return false
  if (/\.part-\d{3,}/.test(u)) return false
  return u.endsWith('.glb') || u.endsWith('.gltf') || /\.glb[?#]/.test(u) || /\.gltf[?#]/.test(u)
}

/**
 * Lowest-footprint LOD for the client's device tier — used while a chunked GLB downloads.
 */
function pickProgressivePreviewLod(assetManifest, deviceProfile) {
  const lods = [...(assetManifest?.lods ?? [])]
    .filter((lod) => lod?.url && isStandaloneGltfUrl(lod.url))

  if (lods.length === 0) return null

  const deviceMatch = (lod) =>
    !Array.isArray(lod.device)
    || lod.device.length === 0
    || lod.device.includes(deviceProfile.deviceClass)

  const prioritized = lods.filter(deviceMatch)
  const pool = prioritized.length ? prioritized : lods

  pool.sort((a, b) => {
    const pa = Number.isFinite(a.priority) ? a.priority : 99
    const pb = Number.isFinite(b.priority) ? b.priority : 99
    if (pa !== pb) return pa - pb
    return (Number(a.bytes) || 1e18) - (Number(b.bytes) || 1e18)
  })

  return pool[0]
}

function FrameRuntimeLoader({
  snapshot, onReady, onProgress, onError, showPartLabels,
}) {
  const gl = useThree((state) => state.gl)
  const deviceProfile = useDeviceProfile(gl)
  const [modelUrl, setModelUrl] = useState(null)
  const previewUrlRef = useRef(null)

  useEffect(() => {
    let active = true
    let revokeBlob = () => {}

    setModelUrl(null)
    previewUrlRef.current = null
    onError?.(null)
    onReady({ engine: null, registry: null })

    const modelPayload = snapshot.model

    const clearPreviewCache = () => {
      const u = previewUrlRef.current
      if (!u) return
      previewUrlRef.current = null
      try {
        useGLTF.clear(u)
      } catch {
        // Older drei builds / cache miss — harmless
      }
    }

    if (!modelPayload?.url) return undefined

    const chunked = isChunkedModel(modelPayload)
    const assetManifest = getFrameAssetManifest(snapshot)
    const previewLod = chunked ? pickProgressivePreviewLod(assetManifest, deviceProfile) : null

    const finalizeFromBlob = async () => {
      const result = await createModelObjectUrl(modelPayload, { onProgress })
      revokeBlob = result.revoke

      if (!active) {
        revokeBlob()
        return
      }

      clearPreviewCache()
      setModelUrl(result.url)
    }

    if (!chunked) {
      const directUrl = normalizeStorageUrl(modelPayload.url)
      if (!directUrl) {
        onError?.('Model URL is missing.')
      } else {
        setModelUrl(directUrl)
      }
      return () => {
        active = false
        revokeBlob()
      }
    }

    if (previewLod?.url) {
      const preview = normalizeStorageUrl(previewLod.url)
      previewUrlRef.current = preview
      setModelUrl(preview)
      onProgress?.({
        phase: 'fetching',
        fileName: previewLod.id || 'preview-lod',
        percent: 0,
        totalParts: 1,
        completedParts: 0,
        cachedParts: 0,
        statusText: previewLod.fileName?.includes('.')
          ? `Loading preview • ${previewLod.fileName}`
          : 'Loading low-detail preview • streaming HD in background',
        parts: [],
      })
    }

    finalizeFromBlob().catch((err) => {
      if (!active) return
      if (!previewLod?.url) {
        const msg = typeof err?.message === 'string' ? err.message : String(err ?? 'Could not assemble model.')
        onError?.(msg)
      } else if (previewUrlRef.current) {
        onProgress?.({
          phase: 'done',
          fileName: modelPayload.fileName || 'model.glb',
          percent: 100,
          totalParts: 1,
          completedParts: 1,
          statusText: 'Preview ready (full-resolution stream failed)',
        })
      }
    })

    return () => {
      active = false
      revokeBlob()
      clearPreviewCache()
    }
  }, [
    snapshot,
    deviceProfile,
    onError,
    onProgress,
    onReady,
  ])

  if (!modelUrl) return null

  return (
    <FrameRuntime
      key={modelUrl}
      snapshot={snapshot}
      modelUrl={modelUrl}
      onReady={onReady}
      onError={onError}
      showPartLabels={showPartLabels}
    />
  )
}

function FrameRuntime({ snapshot, modelUrl, onReady, showPartLabels, onError }) {
  const gltf = useGLTF(modelUrl)
  const { engine, registry, error, isLoaded } = useAutoZEngine(snapshot, gltf)

  useEffect(() => {
    if (error) {
      onError?.(error.message ?? String(error))
    } else if (isLoaded) {
      onError?.(null)
    }
  }, [error, isLoaded, onError])

  useEffect(() => {
    onReady({ engine, registry })
  }, [engine, onReady, registry])

  return (
    registry && showPartLabels && (
      <PartButtons
        parts={registry.frameInteractive}
        onToggle={(partId) => engine?.toggle(partId)}
      />
    )
  )
}
