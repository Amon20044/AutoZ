'use client'

import { useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

const HYSTERESIS = 3

function getDeviceLods(manifest, deviceProfile) {
  const lods = (manifest?.lods ?? [])
    .filter((lod) => lod.device?.includes(deviceProfile.deviceClass))
    .sort((a, b) => (a.distanceMin || 0) - (b.distanceMin || 0))

  if (deviceProfile.allowHighLod) return lods

  const preferred = lods.find((lod) => lod.id === deviceProfile.preferredLod) || lods[0]
  const maxPriority = preferred?.priority ?? 1
  return lods.filter((lod) => (lod.priority || 0) <= maxPriority)
}

function pickDistanceLod(lods, distance, currentLodId) {
  if (lods.length === 0) return null
  const current = lods.find((lod) => lod.id === currentLodId)

  for (const lod of lods) {
    const min = lod.distanceMin ?? 0
    const max = lod.distanceMax ?? 9999
    if (distance >= min && distance <= max) {
      if (!current) return lod
      if (current.id === lod.id) return current

      const movingToHigher = (lod.priority || 0) > (current.priority || 0)
      if (movingToHigher && distance <= max) return lod
      if (!movingToHigher && distance >= min + HYSTERESIS) return lod
      return current
    }
  }

  return lods[lods.length - 1]
}

export function useCameraDistanceLod({ manifest, deviceProfile, currentLodId, object }) {
  const { camera } = useThree()
  const [desiredLodId, setDesiredLodId] = useState(currentLodId)
  const lastCheck = useRef(0)
  const sphere = useMemo(() => {
    if (!object) return null
    const box = new THREE.Box3().setFromObject(object)
    return box.getBoundingSphere(new THREE.Sphere())
  }, [object])

  useFrame((state) => {
    if (!sphere || !manifest || !deviceProfile) return
    if (state.clock.elapsedTime - lastCheck.current < 0.25) return
    lastCheck.current = state.clock.elapsedTime

    const lods = getDeviceLods(manifest, deviceProfile)
    const distance = camera.position.distanceTo(sphere.center)
    const next = pickDistanceLod(lods, distance, currentLodId)
    if (next?.id && next.id !== desiredLodId) {
      setDesiredLodId(next.id)
    }
  })

  return desiredLodId || currentLodId
}
