'use client'

import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { computeFrameCameraPreset } from '@/engine/math/camera'
import { dampVec3, stableDelta } from '@/engine/math/animation'

const PITCH_LIMIT = THREE.MathUtils.degToRad(42)
const LOOK_SPEED = 0.0036

export default function CockpitLookControls({
  enabled,
  frameInfo,
  cameraConfig = {},
  cameraSettings,
  fallbackTarget = [0, 0.8, 0],
}) {
  const { camera, gl, size } = useThree()
  const pose = useRef({
    position: new THREE.Vector3(...(cameraConfig.position ?? [0, 1, 1])),
    target: new THREE.Vector3(...fallbackTarget),
    yaw: 0,
    pitch: 0,
    activePointer: null,
    lastX: 0,
    lastY: 0,
  })
  const settleUntil = useRef(0)

  useEffect(() => {
    if (!enabled) return undefined

    const isMobile = size.width <= 720 || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)
    const preset = computeFrameCameraPreset({
      mode: 'cockpit',
      frameInfo,
      fovDeg: cameraConfig.fov ?? 40,
      aspect: size.width / Math.max(size.height, 1),
      isMobile,
      cameraSettings,
    })

    pose.current.position.fromArray(preset.position)
    pose.current.target.fromArray(preset.target)
    camera.position.copy(pose.current.position)
    camera.lookAt(pose.current.target)

    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
    pose.current.yaw = euler.y
    pose.current.pitch = THREE.MathUtils.clamp(euler.x, -PITCH_LIMIT, PITCH_LIMIT)
    settleUntil.current = performance.now() + 420
    return undefined
  }, [camera, cameraConfig.fov, cameraConfig.position, cameraSettings, enabled, fallbackTarget, frameInfo, size.height, size.width])

  useEffect(() => {
    if (!enabled) return undefined

    const element = gl.domElement

    const onPointerDown = (event) => {
      if (pose.current.activePointer !== null) return
      pose.current.activePointer = event.pointerId
      pose.current.lastX = event.clientX
      pose.current.lastY = event.clientY
      element.setPointerCapture?.(event.pointerId)
      event.preventDefault()
    }

    const onPointerMove = (event) => {
      if (pose.current.activePointer !== event.pointerId) return
      const dx = event.clientX - pose.current.lastX
      const dy = event.clientY - pose.current.lastY
      pose.current.lastX = event.clientX
      pose.current.lastY = event.clientY
      pose.current.yaw -= dx * LOOK_SPEED
      pose.current.pitch = THREE.MathUtils.clamp(
        pose.current.pitch - dy * LOOK_SPEED,
        -PITCH_LIMIT,
        PITCH_LIMIT,
      )
      event.preventDefault()
    }

    const releasePointer = (event) => {
      if (pose.current.activePointer !== event.pointerId) return
      pose.current.activePointer = null
      element.releasePointerCapture?.(event.pointerId)
      event.preventDefault()
    }

    element.addEventListener('pointerdown', onPointerDown, { passive: false })
    element.addEventListener('pointermove', onPointerMove, { passive: false })
    element.addEventListener('pointerup', releasePointer, { passive: false })
    element.addEventListener('pointercancel', releasePointer, { passive: false })

    return () => {
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', releasePointer)
      element.removeEventListener('pointercancel', releasePointer)
    }
  }, [enabled, gl.domElement])

  useFrame((_, rawDt) => {
    if (!enabled) return

    const dt = stableDelta(rawDt)
    if (performance.now() < settleUntil.current) {
      dampVec3(camera.position, pose.current.position, 18, dt)
    } else {
      camera.position.copy(pose.current.position)
    }

    camera.rotation.set(pose.current.pitch, pose.current.yaw, 0, 'YXZ')
    camera.near = 0.005
    camera.far = Math.max(80, Math.max(frameInfo?.radius ?? 4, 1) * 10)
    camera.updateProjectionMatrix()
  })

  return null
}
