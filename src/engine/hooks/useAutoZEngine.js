/**
 * @module engine/hooks/useAutoZEngine
 * React Three Fiber hook — binds AutoZEngine to the R3F scene.
 *
 * Usage:
 *   const { engine, registry, report, isLoaded } = useAutoZEngine(snapshot, gltf)
 *
 *   // In JSX:
 *   <mesh onClick={(e) => engine.onMeshClick(e.object)} />
 *
 *   // Open a door:
 *   engine.open('auto_door.front.left_Door_FL')
 */

'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { AutoZEngine } from '../core/scene-assembler.js'

/**
 * @param {object | null} snapshot - Publish snapshot JSON (null = not ready)
 * @param {import('three-stdlib').GLTF | null} gltf - Loaded GLTF object
 * @param {object} [options]
 * @param {boolean} [options.autoDetect=true]
 * @param {boolean} [options.verbose=false]
 * @returns {UseAutoZEngineResult}
 */
export function useAutoZEngine(snapshot, gltf, options = {}) {
  const { scene, camera } = useThree()
  const engineRef = useRef(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [registry, setRegistry] = useState(null)
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)

  const [engine, setEngine] = useState(null)

  // Initialize engine on snapshot + gltf ready
  useEffect(() => {
    if (!snapshot || !gltf?.scene) {
      engineRef.current = null
      setEngine(null)
      setIsLoaded(false)
      setRegistry(null)
      setReport(null)
      setError(null)
      return undefined
    }

    let cancelled = false
    const nextEngine = new AutoZEngine()

    engineRef.current = nextEngine
    setEngine(nextEngine)

    ;(async () => {
      try {
        const buildReport = await nextEngine.initialize(
          snapshot,
          gltf.scene.clone(), // clone to avoid mutation on re-init
          scene,
          camera,
        )

        if (cancelled) {
          nextEngine.dispose()
          engineRef.current = null
          setEngine(null)
          return
        }

        setRegistry(nextEngine.registry)
        setReport(buildReport)
        setIsLoaded(true)
        setError(null)
        if (options.verbose) console.log('[useAutoZEngine] Loaded.', buildReport)
      } catch (err) {
        if (!cancelled) console.error('[useAutoZEngine] Init failed:', err)
        setError(err)
        setIsLoaded(false)
        nextEngine.dispose()
        engineRef.current = null
        setEngine(null)
        setRegistry(null)
        setReport(null)
      }
    })()

    return () => {
      cancelled = true
      nextEngine.dispose()
      if (engineRef.current === nextEngine) engineRef.current = null
      setEngine(null)
      setIsLoaded(false)
      setRegistry(null)
      setReport(null)
      setError(null)
    }
  }, [snapshot, gltf]) // eslint-disable-line react-hooks/exhaustive-deps

  // Per-frame update
  useFrame((state, delta) => {
    engineRef.current?.update(delta, state.clock.elapsedTime)
  })

  // Stable click handler
  const onMeshClick = useCallback((mesh) => {
    return engineRef.current?.onMeshClick(mesh) ?? null
  }, [])

  return {
    engine,
    registry,
    report,
    isLoaded,
    error,
    onMeshClick,
  }
}

/**
 * @typedef {object} UseAutoZEngineResult
 * @property {AutoZEngine | null} engine
 * @property {import('../core/part-registry.js').PartRegistry | null} registry
 * @property {object | null} report
 * @property {boolean} isLoaded
 * @property {Error | null} error
 * @property {(mesh: THREE.Mesh) => import('../core/part-registry.js').PartEntry | null} onMeshClick
 */
