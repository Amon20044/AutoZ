'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import {
  OrbitControls, PerspectiveCamera, AdaptiveDpr, useGLTF,
} from '@react-three/drei'
import * as THREE from 'three'
import { Disc3, Eye, EyeOff, Lightbulb } from 'lucide-react'
import PostProcessing, { RendererSettings } from './PostProcessing'
import PartButtons from './PartButtons'
import StudioStage from './StudioStage'
import { useAutoZEngine } from '@/engine/hooks/useAutoZEngine'
import { createModelObjectUrl, normalizeStorageUrl } from '@/lib/model/chunked-model'
import { installThreeConsoleFilter } from '@/lib/three/console-filter'
import { useDeviceProfile } from '@/hooks/useDeviceProfile'

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
  const [runtime, setRuntime] = useState({ engine: null, registry: null })
  const [lightsOn, setLightsOn] = useState(false)
  const [wheelsOn, setWheelsOn] = useState(false)
  const [wheelSpeed, setWheelSpeed] = useState(5.5)
  const [modelLoadProgress, setModelLoadProgress] = useState(null)
  const [modelReady, setModelReady] = useState(false)
  const [showPartLabels, setShowPartLabels] = useState(false)

  const lightCount = runtime.registry?.headLights.length || runtime.registry?.lights.length || 0
  const wheelCount = runtime.registry?.wheelSpinParts.length ?? 0

  const handleRuntimeReady = useCallback((nextRuntime) => {
    setRuntime(nextRuntime)
    setModelReady(Boolean(nextRuntime?.engine && nextRuntime?.registry))
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
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0.3}
          maxPolarAngle={Math.PI / 2 - 0.05}
          minDistance={2}
          maxDistance={12}
          enablePan
          panSpeed={0.5}
          target={[0, 0.8, 0]}
        />

        <AdaptiveDpr />
        <StudioStage environment={environment} stage={stage} fog={fog} />

        <Suspense fallback={null}>
          {snapshot.model?.url && (
            <FrameRuntimeLoader
              snapshot={snapshot}
              onReady={handleRuntimeReady}
              onProgress={setModelLoadProgress}
              showPartLabels={showPartLabels}
            />
          )}
        </Suspense>

        {post.enabled !== false && <PostProcessing config={post} />}
      </Canvas>

      {!modelReady && snapshot.model?.url && (
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
  return {
    backgroundColor: snapshot.stage?.backgroundColor ?? snapshot.environment?.backgroundColor ?? '#f7f7f4',
    shadows: snapshot.stage?.shadows ?? snapshot.platform?.enabled ?? true,
    shadowOpacity: snapshot.stage?.shadowOpacity ?? 0.34,
    shadowBlur: snapshot.stage?.shadowBlur ?? 2.8,
    shadowFar: snapshot.stage?.shadowFar ?? 7.5,
    shadowScale: snapshot.stage?.shadowScale ?? 11,
    shadowResolution: snapshot.stage?.shadowResolution ?? 1024,
    shadowColor: snapshot.stage?.shadowColor ?? '#475569',
    environmentIntensity: snapshot.stage?.environmentIntensity ?? 1.18,
    backgroundIntensity: snapshot.stage?.backgroundIntensity ?? 0.75,
  }
}

function getFrameAssetManifest(snapshot) {
  return snapshot.assetManifest
    ?? snapshot.model?.assetManifest
    ?? snapshot.assets?.assetManifest
    ?? null
}

function selectFrameLod(manifest, deviceProfile) {
  const lods = manifest?.lods ?? []
  if (lods.length === 0) return null

  const configured = manifest?.deviceProfiles?.[deviceProfile.deviceClass]?.firstLod
  const deviceLods = lods
    .filter((lod) => lod.device?.includes(deviceProfile.deviceClass))
    .sort((a, b) => (a.priority || 0) - (b.priority || 0))

  return lods.find((lod) => lod.id === configured)
    || lods.find((lod) => lod.id === deviceProfile.preferredLod)
    || deviceLods[0]
    || lods[0]
}

function FrameRuntimeLoader({ snapshot, onReady, onProgress, showPartLabels }) {
  const gl = useThree((state) => state.gl)
  const deviceProfile = useDeviceProfile(gl)
  const [modelUrl, setModelUrl] = useState(null)
  const [modelError, setModelError] = useState(null)
  const assetManifest = getFrameAssetManifest(snapshot)
  const selectedLod = selectFrameLod(assetManifest, deviceProfile)

  useEffect(() => {
    let active = true
    let revoke = () => {}

    setModelUrl(null)
    setModelError(null)
    onReady({ engine: null, registry: null })

    if (selectedLod?.url) {
      setModelUrl(normalizeStorageUrl(selectedLod.url))
      onProgress?.({
        phase: 'done',
        fileName: selectedLod.id,
        percent: 100,
        totalParts: 1,
        completedParts: 1,
        cachedParts: 0,
        statusText: `Using ${selectedLod.id} LOD`,
      })
      return () => {
        active = false
      }
    }

    createModelObjectUrl(snapshot.model, { onProgress })
      .then((result) => {
        revoke = result.revoke
        if (active) {
          setModelUrl(result.url)
        } else {
          revoke()
        }
      })
      .catch((err) => {
        if (active) setModelError(err)
      })

    return () => {
      active = false
      revoke()
    }
  }, [onReady, onProgress, selectedLod, snapshot.model])

  if (modelError || !modelUrl) return null

  return (
    <FrameRuntime
      snapshot={snapshot}
      modelUrl={modelUrl}
      onReady={onReady}
      showPartLabels={showPartLabels}
    />
  )
}

function FrameRuntime({ snapshot, modelUrl, onReady, showPartLabels }) {
  const gltf = useGLTF(modelUrl)
  const { engine, registry } = useAutoZEngine(snapshot, gltf)

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
