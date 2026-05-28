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

installThreeConsoleFilter()

// External camera angles (everything except the interior cockpit). The view
// selector handles Exterior vs Interior; this dropdown only lists exterior angles.
const EXTERNAL_CAMERA_MODES = FRAME_CAMERA_MODES.filter((mode) => mode.id !== 'cockpit')

// Calm spin that lets the rim/spoke pattern stay readable instead of blurring —
// the showroom default when the buyer toggles wheel spin in the frame.
const WHEEL_SHOWCASE_SPEED = 2.4

// FPS-driven progressive LOD streaming. Start on the lightest device LOD, and
// while the smoothed FPS holds above the bar, climb the ladder one rung at a
// time (preloading the next rung in a decoder worker first so the swap is
// gapless). Climbing stops at the device/OS tier cap or when FPS can't hold.
const UPGRADE_FPS = 30          // sustained smoothed FPS required to climb a rung
const UPGRADE_SAMPLE_MS = 500   // climb sampling cadence (matches the FPS tracker)
const UPGRADE_STABLE_TICKS = 3  // ~1.5s of healthy samples (500ms cadence) before a swap
const UPGRADE_COOLDOWN_MS = 2500

// Ordered post-processing quality ladder. A device starts at the tier its
// hardware earned at mount, then — only on mobile/tablet, where static detection
// is coarse — ratchets *up* toward its hardware ceiling while measured FPS proves
// the headroom. Climbing is one-way and latches off after any regression, so it
// can't oscillate. (Oscillation is what tore down render targets and glitched the
// preview before.) The downgrade direction stays owned by qualityMode.
const PP_TIER_ORDER = ['low', 'medium', 'high', 'ultra']
const ppRank = (tier) => {
  const i = PP_TIER_ORDER.indexOf(tier)
  return i < 0 ? 1 : i
}
const ppStepUp = (tier, steps) => PP_TIER_ORDER[Math.min(ppRank(tier) + steps, PP_TIER_ORDER.length - 1)]
const ppFloor = (a, b) => (ppRank(a) <= ppRank(b) ? a : b)

function getInitialFrameQualityMode(deviceCaps) {
  return deviceCaps.mobileTier === 'low' || deviceCaps.gpuTier === 'low' ? 'low' : 'balanced'
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
  const [qualityMode, setQualityMode] = useState(() => getInitialFrameQualityMode(deviceCaps))
  // Runtime upward steps applied to the post-processing tier (hybrid quality).
  const [ppBoost, setPpBoost] = useState(0)
  const [webglStatus, setWebglStatus] = useState('ready')
  // Once the first model is on screen we keep the canvas up during progressive
  // LOD swaps instead of flashing the full-screen spinner each time.
  const [firstModelShown, setFirstModelShown] = useState(false)
  const controlsRef = useRef(null)
  const orbitAngleRef = useRef(0)
  const scrubbingRef = useRef(false)
  const hardwareLowRef = useRef(qualityMode === 'low')
  const healthySinceRef = useRef(0)
  const ppBoostHealthyRef = useRef(0)
  const lastPpBoostRef = useRef(0)
  const ppBoostLatchedRef = useRef(false)
  const lightsOnRef = useRef(false)
  const wheelsOnRef = useRef(false)
  const isCockpit = cameraMode === 'cockpit'
  const orbitScrubEnabled = modelReady && cameraMode === 'auto'
  const performanceRegressed = qualityMode === 'low' || webglStatus === 'lost'
  const effectivePerformanceRegression = performanceRegressed ? 1 : (fpsSample.regression ?? 0)
  // Hybrid quality: static detection picks the floor, runtime FPS ratchets toward
  // the ceiling (mobile/tablet only — desktop already detects accurately). The
  // safety net still forces 'low' the instant frame rate can't hold.
  const detectedPpTier = deviceCaps.postprocessingTier ?? deviceCaps.gpuTier
  const ppCeiling = deviceCaps.maxPostprocessingTier ?? detectedPpTier
  const boostedPpTier = ppFloor(ppStepUp(detectedPpTier, ppBoost), ppCeiling)
  const canBoostPp = ppRank(ppCeiling) > ppRank(detectedPpTier)
  const postprocessingTier = performanceRegressed ? 'low' : boostedPpTier
  const postprocessingEnabled = post.enabled !== false
    && deviceCaps.allowPostprocessing
    && webglStatus !== 'lost'
  // Shadows are decided once — by the device tier + config — and then only ever
  // turned OFF by a regression, never toggled back and forth. Gating on
  // firstModelShown fixes the drei ContactShadows `frames={1}` race: the single
  // baked frame must be captured *after* the car is in the scene, otherwise it
  // bakes an empty shadow and the car looks like it's floating.
  const shadowsEnabled = stage.shadows !== false
    && firstModelShown
    && !performanceRegressed
    && deviceCaps.gpuTier !== 'low'
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
      : { ...stage, shadows: shadowsEnabled }),
    [performanceRegressed, stage, shadowsEnabled],
  )

  const lightCount = runtime.registry?.headLights.length || runtime.registry?.lights.length || 0
  const wheelCount = runtime.registry?.wheelSpinParts.length ?? 0

  useEffect(() => {
    setModelLoadError(null)
    setFirstModelShown(false)
  }, [snapshot?.slug])

  const handleRuntimeReady = useCallback((nextRuntime) => {
    setRuntime(nextRuntime)
    const ready = Boolean(nextRuntime?.engine && nextRuntime?.registry)
    setModelReady(ready)
    if (ready) setFirstModelShown(true)
    setFrameInfo(nextRuntime?.engine?.getFrameInfo?.() ?? null)
    // Signal the embedding parent (landing page, customer iframe, etc.) so it
    // can fade its own loader. Safe no-op when not iframed.
    if (ready && typeof window !== 'undefined' && window.parent !== window) {
      try {
        window.parent.postMessage({ type: 'autoz:ready', slug: snapshot?.slug ?? null }, '*')
      } catch { /* cross-origin parents are fine — they just won't get the signal */ }
    }
  }, [snapshot?.slug])

  // Keep the ref mirrors in sync so the engine-swap effect below can re-apply
  // the *current* toggle state without re-running on every toggle.
  lightsOnRef.current = lightsOn
  wheelsOnRef.current = wheelsOn

  // Re-apply the active toggles whenever the engine instance changes (HMR, slug
  // swap, re-publish, or a progressive LOD upgrade). A LOD swap builds a fresh
  // engine, so without this the headlights/wheels would silently switch off and
  // the UI would lie about the scene state.
  useEffect(() => {
    const engine = runtime.engine
    if (!engine) return
    const lights = runtime.registry?.headLights.length || runtime.registry?.lights.length || 0
    const wheels = runtime.registry?.wheelSpinParts.length ?? 0
    if (lightsOnRef.current && lights > 0) engine.toggleHeadlights(true)
    if (wheelsOnRef.current && wheels > 0) engine.setWheelSpin(true, WHEEL_SHOWCASE_SPEED)
  }, [runtime.engine, runtime.registry])

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

  // ─── Upward quality ratchet (hybrid: hardware floor + FPS-proven ceiling) ────
  // Mobile/tablet detection is deliberately conservative, so a device that holds
  // a high frame rate climbs to the heavier post-processing tier it can actually
  // afford. A strict FPS bar + long stable window + cooldown keep it from
  // thrashing, and it only ever steps up (the regression latch below is the only
  // thing that walks it back).
  useEffect(() => {
    if (!canBoostPp || ppBoostLatchedRef.current || !firstModelShown) return
    if (performanceRegressed || isScrubbing) {
      ppBoostHealthyRef.current = 0
      return
    }
    if (ppRank(boostedPpTier) >= ppRank(ppCeiling)) return

    const fps = fpsSample.fps
    const regression = fpsSample.regression ?? 0
    if (fps == null) return

    if (fps >= 56 && regression < 0.15) {
      const now = performance.now()
      if (!ppBoostHealthyRef.current) {
        ppBoostHealthyRef.current = now
        return
      }
      if (now - ppBoostHealthyRef.current > 7000 && now - lastPpBoostRef.current > 4000) {
        lastPpBoostRef.current = now
        ppBoostHealthyRef.current = 0
        setPpBoost((steps) => steps + 1)
      }
    } else {
      ppBoostHealthyRef.current = 0
    }
  }, [
    canBoostPp, firstModelShown, performanceRegressed, isScrubbing,
    boostedPpTier, ppCeiling, fpsSample.fps, fpsSample.regression,
  ])

  // A regression means the device couldn't hold the tier we climbed to — roll the
  // boost back and latch it off so we never bounce in and out of the heavy shader
  // (that thrash is exactly what used to tear down render targets and glitch).
  useEffect(() => {
    if (!performanceRegressed) return
    ppBoostLatchedRef.current = true
    setPpBoost((steps) => (steps > 0 ? 0 : steps))
  }, [performanceRegressed])

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
                fps={fpsSample.fps}
                ready={modelReady}
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

        {postprocessingEnabled && (
          <PostProcessing
            key={postprocessingTier}
            config={post}
            tier={postprocessingTier}
            deviceClass={deviceCaps.deviceClass}
          />
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

      {!modelReady && !firstModelShown && snapshot.model?.url && !modelLoadError && webglStatus !== 'lost' && (
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
  const hasFramedRef = useRef(false)
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

    // Only re-frame (animate the camera) on a real mode change or the first time
    // we receive model bounds. A progressive LOD swap re-emits frameInfo for the
    // *same* car + mode — re-settling there is what yanked the camera back to the
    // preset and produced the jerk. In that case we just refresh the distance
    // limits above and leave the camera exactly where the user left it.
    const modeChanged = previousMode.current !== mode
    const firstFraming = Boolean(frameInfo) && !hasFramedRef.current
    if (modeChanged || firstFraming || !frameInfo) {
      autoSettleUntil.current = performance.now() + (modeChanged ? 650 : 500)
    }
    if (frameInfo) hasFramedRef.current = true
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
 * Ordered device LOD ladder for the asset manifest: standalone-GLB LODs that
 * target this device class (falling back to all LODs), sorted lightest-first by
 * priority. Each entry is a rung the runtime can stream up to.
 */
function buildLodLadder(assetManifest, deviceClass) {
  const lods = (assetManifest?.lods ?? []).filter((lod) => lod?.url && isStandaloneGltfUrl(lod.url))
  if (lods.length === 0) return []
  const exact = lods.filter((lod) => Array.isArray(lod.device) && lod.device.includes(deviceClass))
  const pool = exact.length ? exact : lods
  return [...pool].sort((a, b) => (
    (Number.isFinite(a.priority) ? a.priority : 99) - (Number.isFinite(b.priority) ? b.priority : 99)
  ))
}

function FrameRuntimeLoader({
  snapshot, onReady, onProgress, onError, showPartLabels, performanceRegression = 0, fps = null, ready = false,
}) {
  const gl = useThree((state) => state.gl)
  const regressionLevel = performanceRegression > 0.5 ? 1 : 0
  const deviceProfile = useDeviceProfile(gl, regressionLevel)
  const deviceClass = deviceProfile.deviceClass

  // Shared loader config so useGLTF.preload (warm-up) and useGLTF (render) hit
  // the same drei cache entry — Draco/KTX2/meshopt all decode in workers.
  const extendLoader = useCallback((loader) => {
    const ktx2 = new KTX2Loader()
    ktx2.setTranscoderPath('/decoders/basis/')
    ktx2.detectSupport(gl)
    loader.setKTX2Loader(ktx2)
  }, [gl])

  const assetManifest = useMemo(() => getFrameAssetManifest(snapshot), [snapshot])
  const ladder = useMemo(() => buildLodLadder(assetManifest, deviceClass), [assetManifest, deviceClass])
  const isLadder = ladder.length > 0

  // Highest rung this device/OS tier may stream up to.
  const maxRung = useMemo(() => {
    if (ladder.length === 0) return 0
    if (deviceClass === 'mobile') return deviceProfile.mobileTier === 'low' ? 0 : ladder.length - 1
    return deviceProfile.allowHighLod ? ladder.length - 1 : 0
  }, [ladder.length, deviceClass, deviceProfile.mobileTier, deviceProfile.allowHighLod])

  const [rung, setRung] = useState(0)
  const [blobUrl, setBlobUrl] = useState(null) // chunked/direct path (no device LODs)
  const previewUrlRef = useRef(null)
  const healthyRef = useRef(0)
  const lastSwapRef = useRef(0)
  const lastTickRef = useRef(0)
  const preloadedRef = useRef(new Set())

  // Latest smoothed FPS mirrored into a ref so the climb loop can read it every
  // frame. The parent dedups identical FPS values (to avoid 2Hz re-renders), so
  // a steady-but-healthy FPS produces no prop changes — which is why a useFrame
  // loop, not an fps-dependency effect, drives the climb.
  const fpsRef = useRef(fps)
  fpsRef.current = fps

  // Reset progressive state when the source model (or device class) changes.
  useEffect(() => {
    onError?.(null)
    setRung(0)
    healthyRef.current = 0
    lastSwapRef.current = 0
    lastTickRef.current = 0
    preloadedRef.current = new Set()
  }, [assetManifest, deviceClass, onError])

  // If the tier cap dropped below the current rung (perf regressed), step down.
  useEffect(() => {
    if (isLadder && rung > maxRung) setRung(maxRung)
  }, [isLadder, rung, maxRung])

  const ladderRung = Math.min(rung, maxRung)
  const ladderUrl = isLadder ? normalizeStorageUrl(ladder[ladderRung].url) : null

  // Surface the active rung to the progress UI.
  useEffect(() => {
    if (!isLadder) return
    const lod = ladder[ladderRung]
    onProgress?.({
      phase: 'done',
      fileName: lod?.fileName || lod?.id || 'device-lod',
      percent: 100,
      totalParts: 1,
      completedParts: 1,
      cachedParts: 0,
      statusText: ladderRung > 0 ? `Streaming ${lod?.id || 'higher'} LOD` : `Loading ${lod?.id || 'device'} LOD`,
      parts: [],
    })
  }, [isLadder, ladder, ladderRung, onProgress])

  // FPS-gated climb, sampled on the tracker's 500ms cadence inside the render
  // loop (a useFrame tick fires every frame even when no React state changes).
  // While the smoothed FPS holds above the bar, warm the next rung in a decoder
  // worker and swap it in once it has been stable for ~1.5s and past cooldown.
  useFrame(() => {
    if (!isLadder || !ready || rung >= maxRung) return

    const now = performance.now()
    if (now - lastTickRef.current < UPGRADE_SAMPLE_MS) return
    lastTickRef.current = now

    const currentFps = fpsRef.current
    if (currentFps == null) return
    if (currentFps < UPGRADE_FPS) {
      healthyRef.current = 0
      return
    }
    healthyRef.current += 1

    const next = ladder[rung + 1]
    if (!next) return
    const nextUrl = normalizeStorageUrl(next.url)
    if (!preloadedRef.current.has(nextUrl)) {
      preloadedRef.current.add(nextUrl)
      try { useGLTF.preload(nextUrl, '/decoders/draco/', true, extendLoader) } catch { /* best effort */ }
    }

    if (healthyRef.current >= UPGRADE_STABLE_TICKS && now - lastSwapRef.current > UPGRADE_COOLDOWN_MS) {
      lastSwapRef.current = now
      healthyRef.current = 0
      setRung((current) => Math.min(current + 1, maxRung))
    }
  })

  // Free the drei cache for a rung we leave behind (and the last rung on unmount).
  useEffect(() => {
    if (!isLadder || !ladderUrl) return undefined
    return () => { try { useGLTF.clear(ladderUrl) } catch { /* cache miss */ } }
  }, [isLadder, ladderUrl])

  // ─── Chunked / direct full model (manifest has no standalone device LODs) ───
  useEffect(() => {
    if (isLadder) return undefined
    let active = true
    let revokeBlob = () => {}

    setBlobUrl(null)
    previewUrlRef.current = null
    onReady({ engine: null, registry: null })

    const modelPayload = snapshot.model
    if (!modelPayload?.url) return undefined

    const clearPreviewCache = () => {
      const u = previewUrlRef.current
      if (!u) return
      previewUrlRef.current = null
      try { useGLTF.clear(u) } catch { /* cache miss */ }
    }

    const chunked = isChunkedModel(modelPayload)

    const finalizeFromBlob = async () => {
      const result = await createModelObjectUrl(modelPayload, { onProgress })
      revokeBlob = result.revoke
      if (!active) {
        revokeBlob()
        return
      }
      clearPreviewCache()
      setBlobUrl(result.url)
    }

    if (!chunked) {
      const directUrl = normalizeStorageUrl(modelPayload.url)
      if (!directUrl) onError?.('Model URL is missing.')
      else setBlobUrl(directUrl)
      return () => {
        active = false
        revokeBlob()
      }
    }

    finalizeFromBlob().catch((err) => {
      if (!active) return
      const msg = typeof err?.message === 'string' ? err.message : String(err ?? 'Could not assemble model.')
      onError?.(msg)
    })

    return () => {
      active = false
      revokeBlob()
      clearPreviewCache()
    }
  }, [isLadder, snapshot, onError, onProgress, onReady])

  const activeUrl = isLadder ? ladderUrl : blobUrl
  if (!activeUrl) return null

  return (
    <FrameRuntime
      key={activeUrl}
      snapshot={snapshot}
      modelUrl={activeUrl}
      extendLoader={extendLoader}
      onReady={onReady}
      onError={onError}
      showPartLabels={showPartLabels}
    />
  )
}

function FrameRuntime({ snapshot, modelUrl, extendLoader, onReady, showPartLabels, onError }) {
  const gl = useThree((state) => state.gl)
  const fallbackExtend = useCallback((loader) => {
    const ktx2 = new KTX2Loader()
    ktx2.setTranscoderPath('/decoders/basis/')
    ktx2.detectSupport(gl)
    loader.setKTX2Loader(ktx2)
  }, [gl])
  const gltf = useGLTF(modelUrl, '/decoders/draco/', true, extendLoader ?? fallbackExtend)
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
