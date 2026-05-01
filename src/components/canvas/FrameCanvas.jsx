'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  OrbitControls, PerspectiveCamera, Environment,
  ContactShadows, AdaptiveDpr, useGLTF,
} from '@react-three/drei'
import * as THREE from 'three'
import PostProcessing, { RendererSettings } from './PostProcessing'
import PartButtons from './PartButtons'
import { useAutoZEngine } from '@/engine/hooks/useAutoZEngine'
import { createModelObjectUrl } from '@/lib/model/chunked-model'

/**
 * Lightweight frame viewer canvas with grouped runtime controls.
 * @param {{ snapshot: object }} props
 */
export default function FrameCanvas({ snapshot }) {
  const fog = snapshot.fog ?? {}
  const cam = snapshot.camera ?? {}
  const post = snapshot.postprocessing ?? {}
  const [runtime, setRuntime] = useState({ engine: null, registry: null })
  const [lightsOn, setLightsOn] = useState(false)
  const [wheelsOn, setWheelsOn] = useState(false)
  const [modelLoadProgress, setModelLoadProgress] = useState(null)
  const [modelReady, setModelReady] = useState(false)

  const lightCount = runtime.registry?.lights.length ?? 0
  const wheelCount = runtime.registry?.wheelSpinParts.length ?? 0

  const handleRuntimeReady = useCallback((nextRuntime) => {
    setRuntime(nextRuntime)
    setModelReady(Boolean(nextRuntime?.engine && nextRuntime?.registry))
  }, [])

  const toggleLights = useCallback(() => {
    const next = !lightsOn
    const applied = runtime.engine?.toggleLights(next)
    if (applied !== false) setLightsOn(next)
  }, [lightsOn, runtime.engine])

  const toggleWheels = useCallback(() => {
    const next = !wheelsOn
    const applied = runtime.engine?.setWheelSpin(next)
    if (applied !== false) setWheelsOn(next)
  }, [runtime.engine, wheelsOn])

  return (
    <div className='frame-canvas-shell'>
      <Canvas
        shadows
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: post.exposure ?? 1.1,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        dpr={[1, 1.75]}
        style={{ background: '#0a0a0f', width: '100%', height: '100%' }}
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

        <AdaptiveDpr pixelated />
        <Environment preset={snapshot.environment?.preset ?? 'studio'} background={snapshot.environment?.background ?? false} />
        {fog.enabled && <fog attach='fog' args={[fog.color ?? '#0a0a0f', fog.near ?? 10, fog.far ?? 50]} />}

        <Suspense fallback={null}>
          {snapshot.model?.url && (
            <FrameRuntimeLoader
              snapshot={snapshot}
              platform={snapshot.platform ?? {}}
              onReady={handleRuntimeReady}
              onProgress={setModelLoadProgress}
            />
          )}
        </Suspense>

        <ContactShadows position={[0, -0.001, 0]} opacity={0.5} blur={1.8} far={6} resolution={512} frames={1} color='#0a0a12' />
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
          title={lightCount > 0 ? 'Toggle lights' : 'No lights detected'}
        >
          <span className='frame-control-icon'>L</span>
          <span>Lights</span>
        </button>
        <button
          type='button'
          className={`frame-control ${wheelsOn ? 'frame-control--active' : ''}`}
          onClick={toggleWheels}
          disabled={!runtime.engine || wheelCount === 0}
          title={wheelCount > 0 ? 'Toggle wheel spin' : 'No wheels detected'}
        >
          <span className='frame-control-icon'>W</span>
          <span>Wheel Spin</span>
        </button>
      </div>
    </div>
  )
}

function FrameRuntimeLoader({ snapshot, platform, onReady, onProgress }) {
  const [modelUrl, setModelUrl] = useState(null)
  const [modelError, setModelError] = useState(null)

  useEffect(() => {
    let active = true
    let revoke = () => {}

    setModelUrl(null)
    setModelError(null)
    onReady({ engine: null, registry: null })

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
  }, [onReady, onProgress, snapshot.model])

  if (modelError || !modelUrl) return <FramePlatform platform={platform} />

  return (
    <FrameRuntime
      snapshot={snapshot}
      platform={platform}
      modelUrl={modelUrl}
      onReady={onReady}
    />
  )
}

function FrameRuntime({ snapshot, platform, modelUrl, onReady }) {
  const gltf = useGLTF(modelUrl)
  const { engine, registry } = useAutoZEngine(snapshot, gltf)

  useEffect(() => {
    onReady({ engine, registry })
  }, [engine, onReady, registry])

  return (
    <>
      <FramePlatform platform={platform} />
      {registry && (
        <PartButtons
          parts={registry.frameInteractive}
          onToggle={(partId) => engine?.toggle(partId)}
        />
      )}
    </>
  )
}

function FramePlatform({ platform }) {
  const radius = platform.radius ?? 3

  if (platform.enabled === false) return null

  return (
    <>
      <mesh position={[0, -0.04, 0]} receiveShadow>
        <cylinderGeometry args={[radius, radius, 0.08, 128]} />
        <meshPhysicalMaterial
          color={platform.color ?? '#e0e0e0'}
          metalness={platform.metalness ?? 0.92}
          roughness={platform.roughness ?? 0.04}
          clearcoat={1.0}
          clearcoatRoughness={0.08}
          reflectivity={1.0}
          envMapIntensity={1.2}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, -0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.02, radius + 0.005, 128]} />
        <meshBasicMaterial color='#333340' />
      </mesh>
    </>
  )
}
