'use client'

import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  OrbitControls, PerspectiveCamera, AdaptiveDpr, useGLTF,
} from '@react-three/drei'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import * as THREE from 'three'
import { Camera, Disc3, Eye, EyeOff, Lightbulb } from 'lucide-react'
import PostProcessing, { RendererSettings } from './PostProcessing'
import PartButtons from './PartButtons'
import StudioStage from './StudioStage'
import ImperativeMeshPicker from './ImperativeMeshPicker'
import CockpitLookControls from './CockpitLookControls'
import FpsTracker from './FpsTracker'
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
import { pickDeviceLod } from '@/lib/assets/lod-manifest'

installThreeConsoleFilter()

function attachContextRecovery(renderer, label) {
  const canvas = renderer?.domElement
  if (!canvas) return
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    console.warn(`[${label}] WebGL context lost — waiting for restore`)
  }, false)
  canvas.addEventListener('webglcontextrestored', () => {
    console.log(`[${label}] WebGL context restored`)
    try { renderer.forceContextRestore?.() } catch { /* ignore */ }
  }, false)
}

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
  const [cameraMode, setCameraMode] = useState(snapshot.camera?.frame?.selectedMode ?? 'auto')
  const [frameInfo, setFrameInfo] = useState(null)
  const [fpsSample, setFpsSample] = useState({ fps: null, regression: 0 })
  const controlsRef = useRef(null)
  const isCockpit = cameraMode === 'cockpit'
  const performanceRegressed = fpsSample.regression > 0.5
  const runtimeStage = useMemo(
    () => (performanceRegressed ? { ...stage, shadows: false, shadowResolution: 512 } : stage),
    [performanceRegressed, stage],
  )

  const lightCount = runtime.registry?.headLights.length || runtime.registry?.lights.length || 0
  const wheelCount = runtime.registry?.wheelSpinParts.length ?? 0

  useEffect(() => {
    setModelLoadError(null)
  }, [snapshot?.slug])

  const handleRuntimeReady = useCallback((nextRuntime) => {
    setRuntime(nextRuntime)
    const ready = Boolean(nextRuntime?.engine && nextRuntime?.registry)
    setModelReady(ready)
    setFrameInfo(nextRuntime?.engine?.getFrameInfo?.() ?? null)
    const savedSpeed = nextRuntime?.registry?.wheelSpinParts?.find((part) => Number.isFinite(part.spinSpeed))?.spinSpeed
    if (Number.isFinite(savedSpeed)) setWheelSpeed(savedSpeed)
    // Signal the embedding parent (landing page, customer iframe, etc.) so it
    // can fade its own loader. Safe no-op when not iframed.
    if (ready && typeof window !== 'undefined' && window.parent !== window) {
      try {
        window.parent.postMessage({ type: 'autoz:ready', slug: snapshot?.slug ?? null }, '*')
      } catch { /* cross-origin parents are fine — they just won't get the signal */ }
    }
  }, [snapshot?.slug])

  // Reset toggle state whenever the engine instance changes (HMR, slug swap,
  // re-publish). Without this, lightsOn/wheelsOn can survive across engines
  // and the UI lies about what the scene is actually doing.
  useEffect(() => {
    setLightsOn(false)
    setWheelsOn(false)
  }, [runtime.engine])

  // Engine methods (toggleHeadlights / setWheelSpin) return the *new state*,
  // which means a successful "turn off" returns `false`. We can't use that as
  // a success signal — instead, check up-front whether the operation is even
  // possible (engine present + parts exist), then drive React state with the
  // boolean we already know we want.
  const toggleLights = useCallback(() => {
    const engine = runtime.engine
    if (!engine || lightCount === 0) return
    const next = !lightsOn
    engine.toggleHeadlights(next)
    setLightsOn(next)
  }, [lightCount, lightsOn, runtime.engine])

  const toggleWheels = useCallback(() => {
    const engine = runtime.engine
    if (!engine || wheelCount === 0) return
    const next = !wheelsOn
    engine.setWheelSpin(next, wheelSpeed)
    setWheelsOn(next)
  }, [runtime.engine, wheelCount, wheelSpeed, wheelsOn])

  const handleWheelSpeedChange = useCallback((value) => {
    setWheelSpeed(value)
    if (wheelsOn) runtime.engine?.setWheelSpin(true, value)
  }, [runtime.engine, wheelsOn])

  const handleFpsSample = useCallback((sample) => {
    setFpsSample((prev) => {
      if (
        prev.fps === sample.fps
        && Math.abs((prev.regression ?? 0) - (sample.regression ?? 0)) < 0.05
      ) {
        return prev
      }
      return sample
    })
  }, [])

  return (
    <div className='frame-canvas-shell'>
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        gl={{
          antialias: true,
          toneMapping: THREE.AgXToneMapping,
          toneMappingExposure: post.exposure ?? 1.1,
          outputColorSpace: THREE.SRGBColorSpace,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: false,
          failIfMajorPerformanceCaveat: false,
        }}
        dpr={[1, performanceRegressed ? 1.25 : 2]}
        style={{ background: backgroundColor, width: '100%', height: '100%' }}
        onCreated={({ gl }) => attachContextRecovery(gl, 'FrameCanvas')}
      >
        <PerspectiveCamera
          makeDefault
          fov={cam.fov ?? 40}
          near={0.01}
          far={100}
          position={cam.position ?? [5, 3, -7]}
        />
        <RendererSettings exposure={post.exposure ?? 1.1} />
        <FrameAdaptiveQuality performanceRegression={fpsSample.regression} />
        <FpsTracker onSample={handleFpsSample} />

        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.1}
          minPolarAngle={0.3}
          maxPolarAngle={Math.PI / 2 - 0.05}
          minDistance={0.05}
          maxDistance={12}
          enablePan={false}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }}
          target={orbitTarget}
          enabled={!isCockpit}
          autoRotate={cameraMode === 'auto'}
          autoRotateSpeed={snapshot.animation?.rotateSpeed ?? 0.35}
        />

        <FrameCameraRig
          mode={cameraMode}
          controlsRef={controlsRef}
          frameInfo={frameInfo}
          fallbackTarget={orbitTarget}
          snapshot={snapshot}
          cameraSettings={snapshot.camera?.frame}
          rotateSpeed={snapshot.animation?.rotateSpeed ?? 0.35}
        />
        <CockpitLookControls
          enabled={isCockpit}
          frameInfo={frameInfo}
          fallbackTarget={orbitTarget}
          cameraConfig={cam}
          cameraSettings={snapshot.camera?.frame}
        />

        <AdaptiveDpr />
        <StudioStage environment={environment} stage={runtimeStage} fog={fog} />

        <FrameLoadBoundary onError={setModelLoadError}>
          <Suspense fallback={null}>
            {snapshot.model?.url && (
              <FrameRuntimeLoader
                snapshot={snapshot}
                onReady={handleRuntimeReady}
                onProgress={setModelLoadProgress}
                onError={setModelLoadError}
                showPartLabels={showPartLabels}
                performanceRegression={fpsSample.regression}
              />
            )}
          </Suspense>
        </FrameLoadBoundary>

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

        {post.enabled !== false && !performanceRegressed && <PostProcessing config={post} />}
      </Canvas>

      {fpsSample.fps !== null && (
        <div className='frame-fps-badge' aria-label={`FPS ${fpsSample.fps}`}>
          {fpsSample.fps} FPS
        </div>
      )}

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
          aria-pressed={lightsOn}
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
          aria-pressed={wheelsOn}
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
          aria-pressed={showPartLabels}
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
    shadowOpacity: s.shadowOpacity ?? 0.52,
    shadowCatcherOpacity: s.shadowCatcherOpacity ?? 0.24,
    shadowBlur: s.shadowBlur ?? 2.2,
    shadowFar: s.shadowFar ?? 8.5,
    shadowScale: s.shadowScale ?? 11,
    shadowResolution: s.shadowResolution ?? 1024,
    shadowColor: s.shadowColor ?? '#1f2937',
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

function FrameAdaptiveQuality({ performanceRegression = 0 }) {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const regressionLevel = performanceRegression > 0.5 ? 1 : 0
  const deviceProfile = useDeviceProfile(gl, regressionLevel)

  useEffect(() => {
    if (!gl || typeof window === 'undefined') return

    gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, deviceProfile.maxDpr))
    gl.shadowMap.enabled = Boolean(deviceProfile.allowShadows)

    scene.traverse((object) => {
      if (object.isLight && object.shadow) {
        const size = deviceProfile.deviceClass === 'desktop' && deviceProfile.allowShadows ? 1024 : 512
        object.shadow.mapSize.width = size
        object.shadow.mapSize.height = size
      }
    })
  }, [
    deviceProfile.allowShadows,
    deviceProfile.deviceClass,
    deviceProfile.maxDpr,
    gl,
    scene,
  ])

  return null
}

function FrameCameraRig({
  mode, controlsRef, frameInfo, fallbackTarget, snapshot, cameraSettings, rotateSpeed = 0.35,
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
      cameraSettings,
    })

    desired.current.position.fromArray(preset.position)
    desired.current.target.fromArray(preset.target)
    desired.current.minDistance = preset.minDistance
    desired.current.maxDistance = preset.maxDistance
    desired.current.autoRotate = mode === 'auto'

    const controls = controlsRef.current
    if (controls) {
      controls.minDistance = preset.minDistance
      controls.maxDistance = preset.maxDistance
      controls.enabled = mode !== 'cockpit'
      controls.autoRotate = mode === 'auto'
      controls.enablePan = false
      controls.minPolarAngle = mode === 'cockpit' ? Math.PI / 2 : 0.3
      controls.maxPolarAngle = mode === 'cockpit' ? Math.PI / 2 : Math.PI / 2 - 0.05
      controls.enableDamping = true
      controls.dampingFactor = 0.08
    }

    autoSettleUntil.current = performance.now() + (previousMode.current === mode ? 500 : 650)
    previousMode.current = mode
  }, [cameraSettings, controlsRef, fallbackTarget, frameInfo, mode, rotateSpeed, size.height, size.width, snapshot.camera?.fov])

  useFrame((_, rawDt) => {
    const dt = stableDelta(rawDt)
    const controls = controlsRef.current
    const target = desired.current.target
    const position = desired.current.position
    const isSettling = performance.now() < autoSettleUntil.current
    const smoothness = mode === 'cockpit' ? 18 : 16

    if (controls) {
      controls.minDistance = desired.current.minDistance
      controls.maxDistance = desired.current.maxDistance
      controls.enabled = mode !== 'cockpit'
      controls.enablePan = false
      controls.minPolarAngle = mode === 'cockpit' ? Math.PI / 2 : 0.3
      controls.maxPolarAngle = mode === 'cockpit' ? Math.PI / 2 : Math.PI / 2 - 0.05
      controls.autoRotate = mode === 'auto'
      if (mode === 'auto') {
        const distance = camera.position.distanceTo(controls.target)
        const comfortableDistance = Math.max((frameInfo?.radius ?? 4) * 1.25, 1)
        const speedScale = THREE.MathUtils.clamp(distance / comfortableDistance, 0.18, 1)
        controls.autoRotateSpeed = rotateSpeed * speedScale
      }
      if (isSettling) {
        dampVec3(controls.target, target, 18, dt)
      }
    }

    if (isSettling) {
      dampVec3(camera.position, position, smoothness, dt)
    }

    const focus = controls?.target ?? target
    const radius = Math.max(frameInfo?.radius ?? 4, 1)
    camera.near = 0.005
    camera.far = Math.max(80, camera.position.distanceTo(focus) + radius * 8)
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
  const lod = pickDeviceLod(assetManifest, deviceProfile.deviceClass)
  return lod?.url && isStandaloneGltfUrl(lod.url) ? lod : null
}

function FrameRuntimeLoader({
  snapshot, onReady, onProgress, onError, showPartLabels, performanceRegression = 0,
}) {
  const gl = useThree((state) => state.gl)
  const regressionLevel = performanceRegression > 0.5 ? 1 : 0
  const deviceProfile = useDeviceProfile(gl, regressionLevel)
  const deviceClass = deviceProfile.deviceClass
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

    const assetManifest = getFrameAssetManifest(snapshot)
    const manifestLod = pickProgressivePreviewLod(assetManifest, { deviceClass })

    if (manifestLod?.url) {
      const lodUrl = normalizeStorageUrl(manifestLod.url)
      previewUrlRef.current = lodUrl
      setModelUrl(lodUrl)
      onProgress?.({
        phase: 'done',
        fileName: manifestLod.fileName || manifestLod.id || 'device-lod',
        percent: 100,
        totalParts: 1,
        completedParts: 1,
        cachedParts: 0,
        statusText: `Loading ${manifestLod.id || 'device'} LOD`,
        parts: [],
      })

      return () => {
        active = false
        clearPreviewCache()
      }
    }

    const chunked = isChunkedModel(modelPayload)
    const previewLod = chunked ? pickProgressivePreviewLod(assetManifest, { deviceClass }) : null

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
    deviceClass,
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
  const gl = useThree((state) => state.gl)
  const extendLoader = useCallback((loader) => {
    const ktx2 = new KTX2Loader()
    ktx2.setTranscoderPath('/decoders/basis/')
    ktx2.detectSupport(gl)
    loader.setKTX2Loader(ktx2)
  }, [gl])
  const gltf = useGLTF(modelUrl, '/decoders/draco/', true, extendLoader)
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

/**
 * Catches anything thrown inside the Suspense — useGLTF parse failures,
 * Draco decoder fetch errors, engine init throws. Forwards to onError so the
 * caller renders a visible message instead of a permanent loading spinner.
 */
class FrameLoadBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.error('[FrameCanvas] Load boundary caught:', error)
    this.props.onError?.(error?.message || String(error) || 'Failed to load 3D scene.')
  }

  render() {
    return this.state.hasError ? null : this.props.children
  }
}
