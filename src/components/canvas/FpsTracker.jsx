'use client'

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

/**
 * Cheap FPS sampler: counts useFrame ticks inside the Canvas, posts a
 * rounded value to the parent every UPDATE_MS instead of every frame so
 * React does not re-render at 60Hz. Also reports a smoothed regression
 * score 0..1 that useDeviceProfile consumes to downgrade weak devices.
 */
const UPDATE_MS = 500
const HEALTHY_FPS = 55
const POOR_FPS = 25

export default function FpsTracker({ onSample }) {
  const state = useRef({
    frames: 0,
    lastUpdate: typeof performance !== 'undefined' ? performance.now() : 0,
    ema: 60,
  })

  useFrame(() => {
    const s = state.current
    s.frames += 1
    const now = performance.now()
    const elapsed = now - s.lastUpdate
    if (elapsed < UPDATE_MS) return

    const fps = (s.frames * 1000) / elapsed
    s.ema = s.ema * 0.6 + fps * 0.4
    s.frames = 0
    s.lastUpdate = now

    const clamped = Math.max(0, Math.min(120, Math.round(s.ema)))
    const regression = clamped >= HEALTHY_FPS
      ? 0
      : clamped <= POOR_FPS
        ? 1
        : (HEALTHY_FPS - clamped) / (HEALTHY_FPS - POOR_FPS)

    onSample?.({ fps: clamped, regression })
  })

  return null
}
