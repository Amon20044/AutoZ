'use client'

import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
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
        {/* Model + Platform together — platform wraps model so they rotate in sync */}
        {snapshot.model?.url && (
          <NormalizedModelWithPlatform
            url={snapshot.model.url}
            platform={platform}
            normConfig={snapshot.import}
          />
        )}
      </Suspense>

      {/* Contact shadows */}
      <ContactShadows position={[0, -0.001, 0]} opacity={0.5} blur={1.8} far={6} resolution={512} frames={1} color='#0a0a12' />
      {post.enabled !== false && <PostProcessing config={post} />}
    </Canvas>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/**
 * Loads the model, normalizes it to match exactly what the editor produced,
 * and renders it on a rotating platform so they stay in sync.
 *
 * When snapshot.import has combinedScale + centerOffset + groundOffset + rotation,
 * we apply the exact same transform that applyNormalization() computed — so the
 * /frame viewer is pixel-perfect with the editor preview.
 *
 * Falls back to auto-normalization for older snapshots that lack those fields.
 */
function NormalizedModelWithPlatform({ url, platform, normConfig }) {
  const { scene } = useGLTF(url)
  const wrapperRef = useRef()

  const autoRotate = platform.autoRotate ?? true
  const rotateSpeed = platform.rotateSpeed ?? 0.12
  const radius = platform.radius ?? 3

  const normalizedScene = useMemo(() => {
    const w = new THREE.Group()
    w.name = '__autoz_frame_norm'

    const obj = scene.clone(true)

    const combinedScale  = normConfig?.combinedScale
    const centerOffset   = normConfig?.centerOffset   // [cx, cz]
    const groundOffset   = normConfig?.groundOffset   // number
    const rotQuaternion  = normConfig?.rotation?.quaternion // [x,y,z,w]

    if (combinedScale && combinedScale > 0 && Array.isArray(centerOffset)) {
      // ─── Exact replication of applyNormalization() ────────────────────
      // object.scale.setScalar(norm.combinedScale)
      obj.scale.setScalar(combinedScale)
      // object.position.set(-norm.centerOffset[0], -norm.groundOffset, -norm.centerOffset[1])
      obj.position.set(-centerOffset[0], -(groundOffset ?? 0), -centerOffset[1])

      // Apply forward rotation to the wrapper group (if stored)
      if (Array.isArray(rotQuaternion) && rotQuaternion.length === 4) {
        w.quaternion.set(rotQuaternion[0], rotQuaternion[1], rotQuaternion[2], rotQuaternion[3])
      }
    } else {
      // ─── Fallback: auto-normalize by bounding box ─────────────────────
      // Used for older snapshots that don't have normalization params stored.
      obj.updateWorldMatrix(true, true)
      const box = new THREE.Box3().setFromObject(obj)
      const size = box.getSize(new THREE.Vector3())

      const maxDim = Math.max(size.x, size.y, size.z)
      if (maxDim > 0) {
        const targetMax = normConfig?.targetMaxDimension ?? 6.0
        const sf = targetMax / maxDim

        obj.scale.setScalar(sf)
        obj.updateWorldMatrix(true, true)
        const scaledBox = new THREE.Box3().setFromObject(obj)
        const scaledCenter = scaledBox.getCenter(new THREE.Vector3())

        obj.position.set(
          obj.position.x - scaledCenter.x,
          obj.position.y - scaledBox.min.y,
          obj.position.z - scaledCenter.z,
        )
      }
    }

    // Enable shadows on all meshes
    obj.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })

    w.add(obj)
    return w
  }, [scene, normConfig])

  // Rotate wrapper group (model + platform in sync)
  useFrame((_, dt) => {
    if (autoRotate && wrapperRef.current) {
      wrapperRef.current.rotation.y += rotateSpeed * dt
    }
  })

  return (
    <group ref={wrapperRef}>
      <primitive object={normalizedScene} />

      {platform.enabled !== false && (
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
      )}
    </group>
  )
}

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

