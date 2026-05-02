'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'

function getPointerNdc(event, domElement) {
  const rect = domElement.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
  return { x, y }
}

/**
 * Enables click/pointer picking for Object3D trees that were attached
 * imperatively (not via JSX), by adding a DOM pointer listener and raycasting.
 *
 * @param {{
 *  enabled?: boolean,
 *  getRoots: () => (THREE.Object3D | null | undefined)[],
 *  onMesh: (mesh: THREE.Object3D) => boolean | void,
 * }} props
 */
export default function ImperativeMeshPicker({ enabled = true, getRoots, onMesh }) {
  const { gl, camera, raycaster } = useThree()

  const rootsGetter = useMemo(() => getRoots, [getRoots])
  const onMeshStable = useMemo(() => onMesh, [onMesh])

  useEffect(() => {
    if (!enabled) return undefined
    if (!gl?.domElement || !camera || !raycaster) return undefined
    if (typeof rootsGetter !== 'function' || typeof onMeshStable !== 'function') return undefined

    const dom = gl.domElement
    const pointer = new THREE.Vector2()

    const handlePointerDown = (event) => {
      // Only primary button / touch
      if (event.button != null && event.button !== 0) return

      const roots = rootsGetter()?.filter(Boolean) ?? []
      if (roots.length === 0) return

      const { x, y } = getPointerNdc(event, dom)
      pointer.set(x, y)
      raycaster.setFromCamera(pointer, camera)

      const objects = roots.flatMap((root) => (root ? [root] : []))
      const hits = raycaster.intersectObjects(objects, true)
      if (!hits.length) return

      // Prefer a mesh hit, but fall back to the first object.
      const hitObject = hits.find((h) => h.object?.isMesh)?.object ?? hits[0].object
      if (!hitObject) return

      const handled = onMeshStable(hitObject)
      if (handled) {
        event.preventDefault?.()
        event.stopPropagation?.()
      }
    }

    dom.addEventListener('pointerdown', handlePointerDown, { passive: false })
    return () => dom.removeEventListener('pointerdown', handlePointerDown)
  }, [camera, enabled, gl?.domElement, raycaster, rootsGetter, onMeshStable])

  return null
}

