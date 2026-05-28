'use client'

import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  OrbitControls, PerspectiveCamera, useGLTF,
} from '@react-three/drei'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import * as THREE from 'three'
import { Armchair, Camera, Car, Disc3, Eye, EyeOff, Lightbulb, Orbit } from 'lucide-react'
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
import { getDeviceProfile, useDeviceProfile } from '@/hooks/useDeviceProfile'
import { computeFrameCameraPreset, FRAME_CAMERA_MODES } from '@/engine/math/camera'
import { dampVec3, stableDelta } from '@/engine/math/animation'
import { pickDeviceLod } from '@/lib/assets/lod-manifest'

installThreeConsoleFilter()

// External camera angles (everything except the interior cockpit). The view
// selector handles Exterior vs Interior; this dropdown only lists exterior angles.
const EXTERNAL_CAMERA_MODES = FRAME_CAMERA_MODES.filter((mode) => mode.id !== 'cockpit')

// Calm spin that lets the rim/spoke pattern stay readable instead of blurring —
// the showroom default when the buyer toggles wheel spin in the frame.
const WHEEL_SHOWCASE_SPEED = 2.4

function getInitialFrameQualityMode() {
  if (typeof window === 'undefined') return 'balanced'

  const memory = navigator.deviceMemory || 4
  const cores = navigator.hardwareConcurrency || 4
  const mobile = window.innerWidth < 720 || /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent || '')
  const lowEnd = memory <= 4 || cores <= 4

  return mobile || lowEnd ? 'low' : 'balanced'
}

function attachContextRecovery(renderer, label, onStatus) {
  const canvas = renderer?.domElement
  if (!canvas) return
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    onStatus?.('lost')
    console.warn(`[${label}] WebGL context lost — waiting for restore`)
  }, false)
  canvas.addEventListener('webglcontextrestored', () => {
    onStatus?.('restored')
    console.log(`[${label}] WebGL context restored`)
    try { renderer.forceContextRestore?.() } catch { /* ignore */ }
  }, false)
}

/**
 * Lightweight frame viewer canvas with grouped runtime controls.
 * @param {{ snapshot: object }} props
 */
export default function FrameCanvas({ snapshot }) {
  // Locked once at mount: device-tier decisions for renderer + post-processing.
  // Why: re-deriving these from runtime FPS causes PostProcessing / DPR to flip
  // mid-session (especially during LOD swaps), which tears down render targets
  // and produces the visible "glitch" during preview. The whole point of this
  // memo is that nothing in the dependency array is allowed to change.
  const deviceCaps = useMemo(() => getDeviceProfile(null, 0), [])
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
  const initialCameraMode = snapshot.camera?.frame?.selectedMode ?? 'auto'
  const [runtime, setRuntime] = useState({ engine: null, registry: null })
  const [lightsOn, setLightsOn] = useState(false)
  const [wheelsOn, setWheelsOn] = useState(false)
  const [modelLoadProgress, setModelLoadProgress] = useState(null)
  const [modelLoadError, setModelLoadError] = useState(null)
  const [modelReady, setModelReady] = useState(false)
  const [showPartLabels, setShowPartLabels] = useState(false)
  const [cameraMode, setCameraMode] = useState(initialCameraMode)
  const [externalMode, setExternalMode] = useState(initialCameraMode === 'cockpit' ? 'auto' : initialCameraMode)
  const [orbitAngle, setOrbitAngle] = useState(0)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [frameInfo, setFrameInfo] = useState(null)
  const [fpsSample, setFpsSample] = useState({ fps: null, regression: 0 })
  const [qualityMode, setQualityMode] = useState(() => getInitialFrameQualityMode())
  const [webglStatus, setWebglStatus] = useState('ready')
  const controlsRef = useRef(null)
  const orbitAngleRef = useRef(0)
  const scrubbingRef = useRef(false)
  const hardwareLowRef = useRef(qualityMode === 'low')
  const healthySinceRef = useRef(0)
  const isCockpit = cameraMode === 'cockpit'
  const orbitScrubEnabled = modelReady && cameraMode === 'auto'
  const performanceRegressed = qualityMode === 'low' || webglStatus === 'lost'
  const effectivePerformanceRegression = performanceRegressed ? 1 : (fpsSample.regression ?? 0)
  const runtimeStage = useMemo(
    () => (performanceRegressed
      ? {
          ...stage,
          shadows: false,
          shadowResolution: 256,
          liveShadows: false,
          environmentIntensity: Math.min(stage.environmentIntensity ?? 1.18, 0.9),
          backgroundIntensity: Math.min(stage.backgroundIntensity ?? 0.75, 0.55),
        }
      : stage),
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
    engine.setWheelSpin(next, WHEEL_SHOWCASE_SPEED)
    setWheelsOn(next)
  }, [runtime.engine, wheelCount, wheelsOn])

  // ─── Exterior / Interior view + 360° orbit scrub ─────────────────────────
  const selectExterior = useCallback(() => {
    setCameraMode((prev) => (prev === 'cockpit' ? externalMode : prev))
  }, [externalMode])

  const selectInterior = useCallback(() => {
    scrubbingRef.current = false
    setIsScrubbing(false)
    setCameraMode('cockpit')
  }, [])

  const handleAngleSelect = useCallback((value) => {
    setExternalMode(value)
    setCameraMode(value)
  }, [])

  const beginScrub = useCallback((event) => {
    const controls = controlsRef.current
    if (typeof controls?.getAzimuthalAngle === 'function') {
      const deg = ((THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()) % 360) + 360) % 360
      orbitAngleRef.current = deg
      setOrbitAngle(deg)
    }
    scrubbingRef.current = true
    setIsScrubbing(true)
    try { event.currentTarget.setPointerCapture?.(event.pointerId) } catch { /* not all inputs support capture */ }
  }, [])

  const endScrub = useCallback(() => {
    scrubbingRef.current = false
    setIsScrubbing(false)
  }, [])

  const handleOrbitAngle = useCallback((value) => {
    if (!Number.isFinite(value)) return
    orbitAngleRef.current = value
    setOrbitAngle(value)
  }, [])

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

  useEffect(() => {
    const fps = fpsSample.fps
    const regression = fpsSample.regression ?? 0
    if (fps == null) return
    if (hardwareLowRef.current) return

    if (fps < 34 || regression > 0.58) {
      healthySinceRef.current = 0
      setQualityMode('low')
      return
    }

    if (qualityMode !== 'low') return

    if (fps > 54 && regression < 0.18) {
      const now = performance.now()
      if (!healthySinceRef.current) {
        healthySinceRef.current = now
        return
      }
      if (now - healthySinceRef.current > 9000) {
        setQualityMode('balanced')
        healthySinceRef.current = 0
      }
    } else {
      healthySinceRef.current = 0
    }
  }, [fpsSample.fps, fpsSample.regression, qualityMode])

  const handleWebglStatus = useCallback((status) => {
    setWebglStatus(status === 'lost' ? 'lost' : 'ready')
    if (status === 'lost') {
      healthySinceRef.current = 0
      setQualityMode('low')
    }
  }, [])

  return (
    <div className='frame-canvas-shell'>
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        gl={{
          antialias: deviceCaps.gpuTier !== 'low',
          toneMapping: THREE.AgXToneMapping,
          toneMappingExposure: post.exposure ?? 1.1,
          outputColorSpace: THREE.SRGBColorSpace,
          powerPreference: deviceCaps.deviceClass === 'mobile' ? 'default' : 'high-performance',
          preserveDrawingBuffer: false,
          failIfMajorPerformanceCaveat: false,
        }}
        dpr={[1, deviceCaps.maxDpr]}
        style={{ background: backgroundColor, width: '100%', height: '100%' }}
        onCreated={({ gl }) => attachContextRecovery(gl, 'FrameCanvas', handleWebglStatus)}
      >
        <PerspectiveCamera
          makeDefault
          fov={cam.fov ?? 40}
          near={0.01}
          far={100}
          position={cam.position ?? [5, 3, -7]}
        />
        <RendererSettings exposure={post.exposure ?? 1.1} />
        <FrameAdaptiveQuality performanceRegression={effectivePerformanceRegression} />
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
          orbitAngleRef={orbitAngleRef}
          scrubbingRef={scrubbingRef}
        />
        <CockpitLookControls
          enabled={isCockpit}
          frameInfo={frameInfo}
          fallbackTarget={orbitTarget}
          cameraConfig={cam}
          cameraSettings={snapshot.camera?.frame}
        />

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
                performanceRegression={effectivePerformanceRegression}
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

        {post.enabled !== false && deviceCaps.allowPostprocessing && (
          <PostProcessing config={post} tier={deviceCaps.gpuTier} deviceClass={deviceCaps.deviceClass} />
        )}
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

      {webglStatus === 'lost' && !modelLoadError && (
        <div className='frame-loading frame-loading--context' role='status'>
          <div className='az-spinner' />
          <div>Restoring 3D view</div>
        </div>
      )}

      {!modelReady && snapshot.model?.url && !modelLoadError && webglStatus !== 'lost' && (
        <div className='frame-loading'>
          <div className='az-spinner' />
        </div>
      )}

      <div className='frame-controls' aria-label='Vehicle controls'>
        {/* Row 1 — drag to orbit 360° around the car (auto-rotate view only) */}
        <div className='frame-row frame-row--angle'>
          <div
            className={`frame-angle-control ${orbitScrubEnabled ? '' : 'is-disabled'} ${isScrubbing ? 'is-scrubbing' : ''}`}
            title={orbitScrubEnabled ? 'Drag to rotate 360° around the car' : 'Switch to Auto Rotate to scrub the 360° view'}
          >
            <span className='frame-control-icon'>
              <Orbit size={13} strokeWidth={2.3} aria-hidden='true' />
            </span>
            <input
              type='range'
              min='0'
              max='360'
              step='1'
              value={Math.round(orbitAngle)}
              disabled={!orbitScrubEnabled}
              aria-label='Rotate 360 degrees around the car'
              onPointerDown={beginScrub}
              onPointerUp={endScrub}
              onPointerCancel={endScrub}
              onLostPointerCapture={endScrub}
              onChange={(e) => handleOrbitAngle(parseFloat(e.target.value))}
            />
            <span className='frame-angle-value'>{Math.round(orbitAngle)}°</span>
          </div>
        </div>

        {/* Row 2 — view selector, camera angle, and icon-only toggles */}
        <div className='frame-row frame-row--main'>
          <div className='frame-view-toggle' role='group' aria-label='View mode'>
            <button
              type='button'
              className={`frame-view-btn ${!isCockpit ? 'frame-view-btn--active' : ''}`}
              onClick={selectExterior}
              aria-pressed={!isCockpit}
            >
              <Car size={13} strokeWidth={2.3} aria-hidden='true' />
              <span>Exterior</span>
            </button>
            <button
              type='button'
              className={`frame-view-btn ${isCockpit ? 'frame-view-btn--active' : ''}`}
              onClick={selectInterior}
              aria-pressed={isCockpit}
            >
              <Armchair size={13} strokeWidth={2.3} aria-hidden='true' />
              <span>Interior</span>
            </button>
          </div>

          <label className='frame-camera-control' title='Camera angle'>
            <span className='frame-control-icon'>
              <Camera size={13} strokeWidth={2.3} aria-hidden='true' />
            </span>
            <select
              value={externalMode}
              disabled={isCockpit}
              onChange={(e) => handleAngleSelect(e.target.value)}
              aria-label='Camera angle'
            >
              {EXTERNAL_CAMERA_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>{mode.label}</option>
              ))}
            </select>
          </label>

          <div className='frame-icon-group'>
            <button
              type='button'
              className={`frame-icon-btn ${lightsOn ? 'frame-icon-btn--active' : ''}`}
              onClick={toggleLights}
              aria-pressed={lightsOn}
              aria-label='Toggle headlights'
              disabled={!runtime.engine || lightCount === 0}
              title={lightCount > 0 ? 'Toggle headlights' : 'No headlights detected'}
            >
              <Lightbulb size={15} strokeWidth={2.2} aria-hidden='true' />
            </button>
            <button
              type='button'
              className={`frame-icon-btn ${wheelsOn ? 'frame-icon-btn--active' : ''}`}
              onClick={toggleWheels}
              aria-pressed={wheelsOn}
              aria-label='Toggle wheel spin'
              disabled={!runtime.engine || wheelCount === 0}
              title={wheelCount > 0 ? 'Toggle wheel spin' : 'No wheels detected'}
            >
              <Disc3 size={15} strokeWidth={2.2} aria-hidden='true' />
            </button>
            <button
              type='button'
              className={`frame-icon-btn ${showPartLabels ? 'frame-icon-btn--active' : ''}`}
              onClick={() => setShowPartLabels((prev) => !prev)}
              aria-pressed={showPartLabels}
              aria-label={showPartLabels ? 'Hide part labels' : 'Show part labels'}
              disabled={!runtime.engine}
              title={showPartLabels ? 'Hide part labels' : 'Show part labels'}
            >
              {showPartLabels
                ? <EyeOff size={15} strokeWidth={2.2} aria-hidden='true' />
                : <Eye size={15} strokeWidth={2.2} aria-hidden='true' />}
            </button>
          </div>
        </div>
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
  orbitAngleRef = null, scrubbingRef = null,
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
  // Scratch objects for the manual 360° azimuth scrub — reused each frame.
  const scrubScratch = useRef({ offset: new THREE.Vector3(), spherical: new THREE.Spherical() })

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
    const scrubbing = Boolean(scrubbingRef?.current) && mode !== 'cockpit'

    if (controls) {
      controls.minDistance = desired.current.minDistance
      controls.maxDistance = desired.current.maxDistance
      controls.enabled = mode !== 'cockpit'
      controls.enablePan = false
      controls.minPolarAngle = mode === 'cockpit' ? Math.PI / 2 : 0.3
      controls.maxPolarAngle = mode === 'cockpit' ? Math.PI / 2 : Math.PI / 2 - 0.05
      // Pause auto-rotation while the user scrubs the 360° slider.
      controls.autoRotate = mode === 'auto' && !scrubbing
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

    // Manual azimuth scrub: orbit the camera around controls.target (the COM
    // pivot) toward the slider angle. drei's OrbitControls.update() runs at
    // priority -1, so setting the position here (priority 0) is the final word.
    if (controls && scrubbing && !isSettling) {
      const { offset, spherical } = scrubScratch.current
      const targetTheta = THREE.MathUtils.degToRad(orbitAngleRef?.current ?? 0)
      offset.copy(camera.position).sub(controls.target)
      spherical.setFromVector3(offset)
      let diff = targetTheta - spherical.theta
      diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      spherical.theta += diff * THREE.MathUtils.clamp(dt * 9, 0, 1)
      offset.setFromSpherical(spherical)
      camera.position.copy(controls.target).add(offset)
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
