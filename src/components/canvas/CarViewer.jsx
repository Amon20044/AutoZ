'use client'

import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { AdaptiveDpr, OrbitControls, PerspectiveCamera, Preload } from '@react-three/drei'
import * as THREE from 'three'

import StudioStage from './StudioStage'
import CarModel from './CarModel'
import PartButtons from './PartButtons'
import PostProcessing, { RendererSettings } from './PostProcessing'
import { installThreeConsoleFilter } from '@/lib/three/console-filter'

installThreeConsoleFilter()

/**
 * Full 3D viewport canvas: assembles the studio scene.
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
  showPartLabels = true,
}) {
  const parts = registry?.interactive ?? []
  const env = sceneConfig.environment ?? { preset: 'studio', background: false }
  const lighting = sceneConfig.lighting ?? {}
  const fog = sceneConfig.fog ?? { enabled: false }
  const stage = sceneConfig.stage ?? {}
  const animation = sceneConfig.animation ?? {}
  const cam = sceneConfig.camera ?? {}
  const post = sceneConfig.postprocessing ?? {}
  const backgroundColor = stage.backgroundColor ?? env.backgroundColor ?? '#f7f7f4'
  const reflectionIntensity = stage.environmentIntensity ?? 1.18

  return (
    <div className='az-viewport'>
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          toneMapping: THREE.AgXToneMapping,
          toneMappingExposure: post.exposure ?? 1.1,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        dpr={[1, 2]}
        style={{ background: backgroundColor }}
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
          autoRotate={animation.autoRotate ?? false}
          autoRotateSpeed={animation.rotateSpeed ?? 0.35}
        />

        <AdaptiveDpr />
        <RendererSettings exposure={post.exposure ?? 1.1} />
        <StudioStage environment={env} stage={stage} fog={fog} />

        <Suspense fallback={null}>
          <ConfigurableLights lighting={lighting} />

          {normalizedRoot && (
            <>
              <CarModel
                normalizedRoot={normalizedRoot}
                registry={registry}
                interactionEngine={interactionEngine}
                onPartClick={onPartClick}
                renderSettings={{ reflectionIntensity, shadows: stage.shadows !== false }}
              />
              {showPartLabels && <PartButtons parts={parts} onToggle={onToggle} />}
            </>
          )}
        </Suspense>

        <Preload all />
        {post.enabled !== false && <PostProcessing config={post} />}
      </Canvas>

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
        Scroll to zoom - Drag to orbit - Click parts to interact
      </div>
    </div>
  )
}

function ConfigurableLights({ lighting }) {
  const ambient = lighting?.ambient ?? { enabled: true, intensity: 0.4 }
  const lights = lighting?.lights ?? []
  const lightIntensity = lighting?.intensity ?? 1

  return (
    <>
      {ambient.enabled && (
        <ambientLight color={ambient.color ?? '#ffffff'} intensity={(ambient.intensity ?? 0.4) * lightIntensity} />
      )}
      {lights.map((light, index) => {
        if (light.type === 'directional') {
          return (
            <directionalLight
              key={index}
              position={light.position}
              intensity={(light.intensity ?? 1) * lightIntensity}
              color={light.color}
              castShadow={light.castShadow ?? false}
              shadow-mapSize-width={light.mapSize ?? 2048}
              shadow-mapSize-height={light.mapSize ?? 2048}
              shadow-camera-left={-6}
              shadow-camera-right={6}
              shadow-camera-top={6}
              shadow-camera-bottom={-6}
              shadow-camera-near={0.2}
              shadow-camera-far={18}
              shadow-bias={light.bias ?? -0.00008}
              shadow-normalBias={light.normalBias ?? 0.018}
            />
          )
        }

        if (light.type === 'point') {
          return (
            <pointLight
              key={index}
              position={light.position}
              intensity={(light.intensity ?? 1) * lightIntensity}
              color={light.color}
            />
          )
        }

        return null
      })}
    </>
  )
}
