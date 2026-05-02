'use client'

import { useEffect, useMemo } from 'react'
import { ContactShadows, Environment } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

import RadialFloor from './RadialFloor'

function clampPositive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function SceneAtmosphere({ environment, stage, fog }) {
  const scene = useThree((state) => state.scene)
  const backgroundColor = stage.backgroundColor ?? environment.backgroundColor ?? '#f7f7f4'
  const fogEnabled = Boolean(fog.enabled)
  const fogColor = fog.color ?? backgroundColor
  const fogNear = clampPositive(fog.near, 8)
  const fogFar = Math.max(clampPositive(fog.far, 34), fogNear + 1)

  useEffect(() => {
    if (environment.background) return undefined

    scene.background = new THREE.Color(backgroundColor)
    return () => {
      scene.background = null
    }
  }, [backgroundColor, environment.background, scene])

  useEffect(() => {
    if (!fogEnabled) {
      scene.fog = null
      return undefined
    }

    scene.fog = new THREE.Fog(fogColor, fogNear, fogFar)
    return () => {
      scene.fog = null
    }
  }, [fogColor, fogEnabled, fogFar, fogNear, scene])

  return null
}

export default function StudioStage({ environment = {}, stage = {}, fog = {} }) {
  const shadowOptions = useMemo(() => ({
    opacity: stage.shadowOpacity ?? 0.34,
    blur: stage.shadowBlur ?? 2.8,
    far: stage.shadowFar ?? 7.5,
    scale: stage.shadowScale ?? 11,
    resolution: stage.shadowResolution ?? 1024,
    color: stage.shadowColor ?? '#475569',
    frames: stage.liveShadows ? Infinity : 1,
  }), [stage])

  const backgroundColor = stage.backgroundColor ?? environment.backgroundColor ?? '#f7f7f4'
  const showShadows = stage.shadows !== false
  const radialEnabled = stage.radialFloorEnabled !== false
  const radialColor = stage.radialFloorColor ?? '#a8b2c8'
  const radialOpacity = Number.isFinite(stage.radialFloorOpacity) ? stage.radialFloorOpacity : 0.48
  const radialInner = Number.isFinite(stage.radialFloorInner) ? stage.radialFloorInner : 0.18
  const radialOuter = Number.isFinite(stage.radialFloorOuter) ? stage.radialFloorOuter : 1.15

  return (
    <>
      <Environment
        preset={environment.preset ?? 'studio'}
        background={environment.background ?? false}
        environmentIntensity={stage.environmentIntensity ?? 1.18}
        backgroundIntensity={stage.backgroundIntensity ?? 0.75}
      />
      <SceneAtmosphere environment={environment} stage={{ ...stage, backgroundColor }} fog={fog} />

      {radialEnabled && (
        <RadialFloor
          color={radialColor}
          opacity={radialOpacity}
          inner={radialInner}
          outer={radialOuter}
        />
      )}

      {showShadows && (
        <>
          <ContactShadows
            position={[0, 0.002, 0]}
            opacity={shadowOptions.opacity}
            blur={shadowOptions.blur}
            far={shadowOptions.far}
            scale={shadowOptions.scale}
            resolution={shadowOptions.resolution}
            frames={shadowOptions.frames}
            color={shadowOptions.color}
          />
        </>
      )}
    </>
  )
}
