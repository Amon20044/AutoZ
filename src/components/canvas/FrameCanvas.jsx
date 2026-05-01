'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber'
import {
  OrbitControls, PerspectiveCamera, Environment,
  ContactShadows, AdaptiveDpr, useGLTF,
} from '@react-three/drei'
import * as THREE from 'three'
import PostProcessing, { RendererSettings } from './PostProcessing'

/**
 * Lightweight frame viewer canvas — loads published snapshot and renders.
 * @param {{ snapshot: object }} props
 */
export default function FrameCanvas({ snapshot }) {
  const platform = snapshot.platform ?? {}
  const fog = snapshot.fog ?? {}
  const cam = snapshot.camera ?? {}
  const post = snapshot.postprocessing ?? {}

  return (
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

      {/* Environment */}
      <Environment preset={snapshot.environment?.preset ?? 'studio'} background={snapshot.environment?.background ?? false} />

      {/* Fog */}
      {fog.enabled && <fog attach='fog' args={[fog.color ?? '#0a0a0f', fog.near ?? 10, fog.far ?? 50]} />}

      {/* Lighting */}
      <SnapshotLights lighting={snapshot.lighting} />

      <Suspense fallback={null}>
        {/* Platform */}
        {platform.enabled !== false && (
          <RotatingPlatform
            radius={platform.radius ?? 3}
            color={platform.color ?? '#e0e0e0'}
            metalness={platform.metalness ?? 0.92}
            roughness={platform.roughness ?? 0.04}
            autoRotate={platform.autoRotate ?? true}
            rotateSpeed={platform.rotateSpeed ?? 0.12}
          />
        )}

        {/* Model */}
        {snapshot.model?.url && <SnapshotModel url={snapshot.model.url} />}
      </Suspense>

      {/* Contact shadows */}
      <ContactShadows position={[0, -0.001, 0]} opacity={0.5} blur={1.8} far={6} resolution={512} frames={1} color='#0a0a12' />
      {post.enabled !== false && <PostProcessing config={post} />}
    </Canvas>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SnapshotLights({ lighting }) {
  const lightIntensity = lighting?.intensity ?? 1

  if (!lighting) {
    return (
      <>
        <ambientLight intensity={0.35} />
        <directionalLight position={[4, 6, -4]} intensity={2.2} castShadow />
        <directionalLight position={[-4, 3, 3]} intensity={0.8} color='#dbeafe' />
        <directionalLight position={[0, 4, 6]} intensity={1.1} />
      </>
    )
  }

  return (
    <>
      {lighting.ambient?.enabled && (
        <ambientLight color={lighting.ambient.color} intensity={(lighting.ambient.intensity ?? 0.35) * lightIntensity} />
      )}
      {(lighting.lights ?? []).map((l, i) => {
        if (l.type === 'directional') {
          return (
            <directionalLight
              key={i}
              position={l.position}
              intensity={(l.intensity ?? 1) * lightIntensity}
              color={l.color}
              castShadow={l.castShadow}
            />
          )
        }
        if (l.type === 'point') {
          return <pointLight key={i} position={l.position} intensity={(l.intensity ?? 1) * lightIntensity} color={l.color} />
        }
        return null
      })}
    </>
  )
}

function RotatingPlatform({ radius, color, metalness, roughness, autoRotate, rotateSpeed }) {
  const ref = useRef()
  useFrame((_, dt) => {
    if (autoRotate && ref.current) ref.current.rotation.y += rotateSpeed * dt
  })

  return (
    <group ref={ref}>
      <mesh position={[0, -0.04, 0]} receiveShadow>
        <cylinderGeometry args={[radius, radius, 0.08, 128]} />
        <meshPhysicalMaterial
          color={color}
          metalness={metalness}
          roughness={roughness}
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
    </group>
  )
}

function SnapshotModel({ url }) {
  const { scene } = useGLTF(url)

  useEffect(() => {
    // Enable shadows on all meshes
    scene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
  }, [scene])

  return <primitive object={scene} />
}
