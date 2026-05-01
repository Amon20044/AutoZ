'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Renders the loaded + normalized car model in the scene.
 * Handles raycasting clicks to fire onPartClick.
 *
 * @param {{ normalizedRoot: THREE.Group | null, registry: PartRegistry | null, interactionEngine: InteractionEngine | null, onPartClick: (part: PartEntry) => void }} props
 */
export default function CarModel({ normalizedRoot, registry, interactionEngine, onPartClick }) {
  const groupRef = useRef()
  const { raycaster, pointer, camera } = useThree()

  // Add the normalized root to our group once
  useEffect(() => {
    if (!normalizedRoot || !groupRef.current) return
    // Clear previous children
    while (groupRef.current.children.length > 0) {
      groupRef.current.remove(groupRef.current.children[0])
    }
    groupRef.current.add(normalizedRoot)
    return () => {
      if (groupRef.current && normalizedRoot.parent === groupRef.current) {
        groupRef.current.remove(normalizedRoot)
      }
    }
  }, [normalizedRoot])

  // Per-frame interaction engine update
  useFrame((state, dt) => {
    if (interactionEngine && registry) {
      interactionEngine.update(registry, dt, state.clock.elapsedTime)
    }
  })

  // Click handler — raycast to find clicked part
  const handleClick = (e) => {
    e.stopPropagation()
    if (!registry) return

    const mesh = e.object
    // Walk up to find the mesh if we hit a child
    let target = mesh
    while (target && !target.isMesh) target = target.parent

    if (!target?.isMesh) return

    // Find which part owns this mesh
    for (const part of registry.interactive) {
      const owns = part.meshObjects.some((m) => m === target || m.uuid === target.uuid)
      if (owns) {
        onPartClick?.(part)
        return
      }
    }
  }

  return (
    <group ref={groupRef} onClick={handleClick} />
  )
}
