'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useCameraDistanceLod } from '@/hooks/useCameraDistanceLod'
import { useDeviceProfile } from '@/hooks/useDeviceProfile'
import { disposeObject3D } from '@/lib/three/dispose-object'
import { loadGltf } from '@/lib/three/gltf-loader'
import { applyViewerOptimizations, getRendererDebugStats } from '@/lib/three/viewer-optimizations'

function selectFirstLod(manifest, deviceProfile, initialQuality) {
  const lods = manifest?.lods ?? []
  const deviceLods = lods
    .filter((lod) => lod.device?.includes(deviceProfile.deviceClass))
    .sort((a, b) => (a.priority || 0) - (b.priority || 0))

  if (initialQuality === 'high' && deviceProfile.allowHighLod) {
    return [...deviceLods].sort((a, b) => (b.priority || 0) - (a.priority || 0))[0] || lods[0]
  }

  if (initialQuality === 'low') {
    return deviceLods[0] || lods[0]
  }

  const configured = manifest?.deviceProfiles?.[deviceProfile.deviceClass]?.firstLod
  return lods.find((lod) => lod.id === configured)
    || lods.find((lod) => lod.id === deviceProfile.preferredLod)
    || deviceLods[0]
    || lods[0]
}

function getPreloadLod(manifest, deviceProfile, currentLodId) {
  if (!deviceProfile.allowHighLod) return null

  const candidates = (manifest?.lods ?? [])
    .filter((lod) => lod.device?.includes(deviceProfile.deviceClass))
    .filter((lod) => lod.id !== currentLodId)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))

  if (deviceProfile.deviceClass === 'mobile') {
    return candidates.find((lod) => lod.id.includes('medium')) || null
  }

  return candidates[0] || null
}

export default function ProgressiveCarModel({
  manifest,
  initialQuality = 'auto',
  onFirstVisible,
  onFirstProgress,
  onDebugChange,
}) {
  const groupRef = useRef(null)
  const cacheRef = useRef(new Map())
  const loadingRef = useRef(new Map())
  const visibleObjectRef = useRef(null)
  const { gl, scene, invalidate } = useThree()
  const deviceProfile = useDeviceProfile(gl)
  const [currentLodId, setCurrentLodId] = useState(null)
  const [currentObject, setCurrentObject] = useState(null)
  const desiredLodId = useCameraDistanceLod({
    manifest,
    deviceProfile,
    currentLodId,
    object: currentObject,
  })

  const firstLod = useMemo(
    () => selectFirstLod(manifest, deviceProfile, initialQuality),
    [deviceProfile, initialQuality, manifest],
  )

  const loadLod = useCallback(async (lod, { visible = false, signal } = {}) => {
    if (!lod) return null
    const cached = cacheRef.current.get(lod.id)
    if (cached) {
      cached.lastUsed = performance.now()
      return cached
    }

    if (loadingRef.current.has(lod.id)) return loadingRef.current.get(lod.id)

    const promise = loadGltf(lod.url, gl, {
      signal,
      onProgress: visible ? onFirstProgress : undefined,
    }).then((gltf) => {
      const loaded = {
        id: lod.id,
        lod,
        gltf,
        scene: gltf.scene,
        bytes: lod.bytes || 0,
        lastUsed: performance.now(),
      }
      cacheRef.current.set(lod.id, loaded)
      loadingRef.current.delete(lod.id)
      return loaded
    }).catch((err) => {
      loadingRef.current.delete(lod.id)
      throw err
    })

    loadingRef.current.set(lod.id, promise)
    return promise
  }, [gl, onFirstProgress])

  const showLod = useCallback((loaded) => {
    if (!loaded || !groupRef.current) return

    const object = loaded.scene
    if (visibleObjectRef.current) {
      visibleObjectRef.current.parent?.remove(visibleObjectRef.current)
    }
    visibleObjectRef.current = object
    groupRef.current.clear()
    groupRef.current.add(object)
    setCurrentObject(object)
    setCurrentLodId(loaded.id)
    invalidate()
  }, [invalidate])

  const evictCache = useCallback((keepIds = []) => {
    const keep = new Set(keepIds)
    const maxItems = deviceProfile.deviceClass === 'desktop' ? 3 : 2
    const entries = [...cacheRef.current.values()]
      .filter((entry) => !keep.has(entry.id))
      .sort((a, b) => a.lastUsed - b.lastUsed)

    while (cacheRef.current.size > maxItems && entries.length > 0) {
      const entry = entries.shift()
      cacheRef.current.delete(entry.id)
      disposeObject3D(entry.scene)
    }
  }, [deviceProfile.deviceClass])

  useEffect(() => {
    if (!manifest || !firstLod) return undefined

    const controller = new AbortController()
    let active = true

    applyViewerOptimizations(gl, scene, deviceProfile)
    loadLod(firstLod, { visible: true, signal: controller.signal })
      .then((loaded) => {
        if (!active) return
        showLod(loaded)
        onFirstVisible?.(loaded)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.error('[ProgressiveCarModel] first LOD failed:', err)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [deviceProfile, firstLod, gl, loadLod, manifest, onFirstVisible, scene, showLod])

  useEffect(() => {
    if (!currentLodId || !manifest) return
    const next = getPreloadLod(manifest, deviceProfile, currentLodId)
    if (!next) return

    const run = () => {
      loadLod(next).catch(() => {})
    }
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 2500 })
      return () => window.cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(run, 700)
    return () => window.clearTimeout(id)
  }, [currentLodId, deviceProfile, loadLod, manifest])

  useEffect(() => {
    if (!desiredLodId || desiredLodId === currentLodId) return
    if (deviceProfile.deviceClass === 'mobile' && desiredLodId.includes('desktop')) return

    const lod = manifest?.lods?.find((entry) => entry.id === desiredLodId)
    if (!lod) return

    const controller = new AbortController()
    loadLod(lod, { signal: controller.signal })
      .then((loaded) => {
        showLod(loaded)
        evictCache([loaded.id, currentLodId].filter(Boolean))
      })
      .catch(() => {
        // Keep the current visible LOD if background upgrade fails.
      })

    return () => controller.abort()
  }, [currentLodId, desiredLodId, deviceProfile.deviceClass, evictCache, loadLod, manifest, showLod])

  useFrame(() => {
    if (!onDebugChange) return
    onDebugChange({
      currentLodId,
      deviceProfile,
      renderer: getRendererDebugStats(gl),
      cacheSize: cacheRef.current.size,
    })
  })

  useEffect(() => () => {
    if (visibleObjectRef.current) visibleObjectRef.current.parent?.remove(visibleObjectRef.current)
    for (const entry of cacheRef.current.values()) disposeObject3D(entry.scene)
    cacheRef.current.clear()
  }, [])

  return <group ref={groupRef} />
}
