'use client'

import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { applyAutomotiveMaterialTuning } from '@/lib/three/studio-rendering'

/**
 * Renders the loaded + normalized car model in the scene.
 * Handles raycasting clicks to fire onPartClick.
 *
 * @param {{ normalizedRoot: THREE.Group | null, registry: PartRegistry | null, interactionEngine: InteractionEngine | null, onPartClick: (part: PartEntry) => void }} props
 */
export default function CarModel({
  normalizedRoot,
  registry,
  interactionEngine,
  onPartClick,
  renderSettings = {},
}) {
  const groupRef = useRef()
  useThree((state) => state.scene)
  const reflectionIntensity = renderSettings.reflectionIntensity ?? 1.2
  const shadows = renderSettings.shadows !== false

  // Add the normalized root to our group once
  useEffect(() => {
    const group = groupRef.current
    if (!normalizedRoot || !group) return
    applyAutomotiveMaterialTuning(normalizedRoot, { reflectionIntensity, shadows })
    // Clear previous children
    while (group.children.length > 0) {
      group.remove(group.children[0])
    }
    group.add(normalizedRoot)
    return () => {
      if (normalizedRoot.parent === group) {
        group.remove(normalizedRoot)
      }
    }
  }, [normalizedRoot, reflectionIntensity, shadows])

  // Per-frame interaction engine update
  useFrame((state, dt) => {
    if (interactionEngine && registry) {
      interactionEngine.update(registry, dt, state.clock.elapsedTime)
    }
  })

  // Part picking is handled by ImperativeMeshPicker (tap-vs-drag aware), so the
  // model group itself intentionally has no click handler.
  return (
    <group ref={groupRef} />
  )
}
