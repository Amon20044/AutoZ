'use client'

import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  OrbitControls, PerspectiveCamera, Preload,
  AdaptiveDpr, Environment, ContactShadows,
} from '@react-three/drei'
import * as THREE from 'three'

import StudioPlatform from './StudioPlatform'
import StudioLights from './StudioLights'
import CarModel from './CarModel'
import PartButtons from './PartButtons'

/**
 * Full 3D viewport canvas — assembles the studio scene.
 * Responds to sceneConfig changes from the right-side settings panel.
 */
export default function CarViewer({
  normalizedRoot,
  registry,
  interactionEngine,
  sceneStats,
  sceneConfig = {},
  onPartClick,
  onToggle,
}) {
  const parts = registry?.interactive ?? []
  const env = sceneConfig.environment ?? { preset: 'studio', background: false }
  const lighting = sceneConfig.lighting ?? {}
  const fog = sceneConfig.fog ?? { enabled: false }
  const platform = sceneConfig.platform ?? {}
  const cam = sceneConfig.camera ?? {}

  return (
    <div className='az-viewport'>
      <Canvas
        shadows
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        dpr={[1, 1.75]}
        style={{ background: '#0a0a0f' }}
      >
        <PerspectiveCamera
          makeDefault
          fov={cam.fov ?? 40}
          near={0.01}
          far={100}
          position={cam.position ?? [5, 3, -7]}
        />

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

        {/* HDRI environment — responds to config changes */}
        <Environment preset={env.preset ?? 'studio'} background={env.background ?? false} />

        {/* Fog */}
        {fog.enabled && (
          <fog attach='fog' args={[fog.color ?? '#0a0a0f', fog.near ?? 10, fog.far ?? 50]} />
        )}

        <Suspense fallback={null}>
          {/* Configurable lighting */}
          <ConfigurableLights lighting={lighting} />

          {/* Platform */}
          {platform.enabled !== false && (
            <StudioPlatform
              autoRotate={platform.autoRotate ?? (!normalizedRoot)}
              rotateSpeed={platform.rotateSpeed ?? 0.12}
              radius={platform.radius ?? 3}
              color={platform.color}
              metalness={platform.metalness}
              roughness={platform.roughness}
            />
          )}

          {/* Contact shadows */}
          <ContactShadows
            position={[0, -0.001, 0]}
            opacity={0.55}
            blur={1.8}
            far={6}
            resolution={512}
            frames={1}
            color='#0a0a12'
          />

          {normalizedRoot && (
            <>
              <CarModel
                normalizedRoot={normalizedRoot}
                registry={registry}
                interactionEngine={interactionEngine}
                onPartClick={onPartClick}
              />
              <PartButtons parts={parts} onToggle={onToggle} />
            </>
          )}
        </Suspense>

        <Preload all />
      </Canvas>

      {/* Viewport stats overlay */}
      {sceneStats && (
        <div className='az-viewport-stats'>
          <div className='az-viewport-stat'>
            {Math.round(sceneStats.totalTris / 1000)}k tris
          </div>
          <div className='az-viewport-stat'>
            {sceneStats.meshCount} meshes
          </div>
          <div className='az-viewport-stat'>
            {sceneStats.uniqueMaterials} materials
          </div>
        </div>
      )}

      <div className='az-viewport-hint'>
        Scroll to zoom · Drag to orbit · Click parts to interact
      </div>
    </div>
  )
}

/** Lighting component driven by config */
function ConfigurableLights({ lighting }) {
  const ambient = lighting?.ambient ?? { enabled: true, intensity: 0.35 }
  const lights = lighting?.lights ?? []

  return (
    <>
      {ambient.enabled && (
        <ambientLight color={ambient.color ?? '#ffffff'} intensity={ambient.intensity ?? 0.35} />
      )}
      {lights.map((l, i) => {
        if (l.type === 'directional') {
          return (
            <directionalLight
              key={i}
              position={l.position}
              intensity={l.intensity}
              color={l.color}
              castShadow={l.castShadow ?? false}
              shadow-mapSize-width={1024}
              shadow-mapSize-height={1024}
            />
          )
        }
        if (l.type === 'point') {
          return <pointLight key={i} position={l.position} intensity={l.intensity} color={l.color} />
        }
        return null
      })}
    </>
  )
}
