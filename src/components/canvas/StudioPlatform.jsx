'use client'

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Studio platform — metallic rotating cylinder.
 * Color, metalness, roughness are configurable from the settings panel.
 */
export default function StudioPlatform({
  autoRotate = true,
  rotateSpeed = 0.12,
  radius = 3,
  color = '#e0e0e0',
  metalness = 0.92,
  roughness = 0.04,
}) {
  const groupRef = useRef()

  useFrame((_, dt) => {
    if (autoRotate && groupRef.current) {
      groupRef.current.rotation.y += rotateSpeed * dt
    }
  })

  return (
    <group ref={groupRef}>
      {/* Metallic cylinder platform */}
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

      {/* Subtle rim ring */}
      <mesh position={[0, -0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.02, radius + 0.005, 128]} />
        <meshBasicMaterial color='#333340' />
      </mesh>
    </group>
  )
}
