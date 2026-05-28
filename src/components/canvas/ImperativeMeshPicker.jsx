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

// A press only counts as a "click" (part toggle) if the pointer barely moved
// and was released quickly. Anything past these thresholds is treated as a
// drag / long-press and is left for OrbitControls to handle (orbit, pan).
const TAP_MOVE_THRESHOLD_PX = 8
const TAP_MAX_DURATION_MS = 500

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

    // Tracks the in-progress press so we can tell a tap from a drag on release.
    let press = null

    const pick = (event) => {
      const roots = rootsGetter()?.filter(Boolean) ?? []
      if (roots.length === 0) return false

      const { x, y } = getPointerNdc(event, dom)
      pointer.set(x, y)
      raycaster.setFromCamera(pointer, camera)

      const hits = raycaster.intersectObjects(roots, true)
      if (!hits.length) return false

      // Prefer a mesh hit, but fall back to the first object.
      const hitObject = hits.find((h) => h.object?.isMesh)?.object ?? hits[0].object
      if (!hitObject) return false

      return Boolean(onMeshStable(hitObject))
    }

    const handlePointerDown = (event) => {
      // Only primary button / touch.
      if (event.button != null && event.button !== 0) return
      // Record the press; do NOT pick yet so a drag-to-orbit isn't hijacked.
      press = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
        moved: false,
      }
    }

    const handlePointerMove = (event) => {
      if (!press || event.pointerId !== press.id || press.moved) return
      const dx = event.clientX - press.x
      const dy = event.clientY - press.y
      if (Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD_PX) press.moved = true
    }

    const handlePointerUp = (event) => {
      if (!press || event.pointerId !== press.id) return
      const current = press
      press = null

      // Drag or long-press → leave it to OrbitControls, don't toggle.
      if (current.moved) return
      if (event.timeStamp - current.time > TAP_MAX_DURATION_MS) return

      const handled = pick(event)
      if (handled) {
        event.preventDefault?.()
        event.stopPropagation?.()
      }
    }

    const handlePointerCancel = (event) => {
      if (press && event.pointerId === press.id) press = null
    }

    dom.addEventListener('pointerdown', handlePointerDown, { passive: false })
    // Listen on window for move/up so a release outside the canvas still resets.
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('pointerup', handlePointerUp, { passive: false })
    window.addEventListener('pointercancel', handlePointerCancel, { passive: true })

    return () => {
      dom.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [camera, enabled, gl?.domElement, raycaster, rootsGetter, onMeshStable])

  return null
}

