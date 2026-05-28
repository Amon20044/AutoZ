'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'

const FrameCanvas = dynamic(() => import('@/components/canvas/FrameCanvas'), { ssr: false })

const DEMO_SLUG = 'demo'
const DEMO_CONFIG_URL = '/demo/demo-config.json'
const DEMO_MODEL_URL = '/Fortuner-compressed.glb'
const DEMO_MODEL_NAME = 'Fortuner-compressed.glb'

const DEFAULT_DEMO_SNAPSHOT = {
  version: 1,
  slug: 'demo-landing',
  model: {
    url: DEMO_MODEL_URL,
    fileName: DEMO_MODEL_NAME,
    path: DEMO_MODEL_NAME,
    contentType: 'model/gltf-binary',
  },
  runtimeAssets: [],
  thumbnail: null,
  textureAssets: [],
  materials: [],
  assetManifest: null,
  branding: { watermark: true, text: 'made in AutoZ' },
  performance: { preset: 'high' },
  parts: [],
  import: {},
  environment: { preset: 'studio', background: false, backgroundColor: '#0b0e14' },
  lighting: {
    intensity: 1,
    ambient: { enabled: true, color: '#ffffff', intensity: 0.42 },
    lights: [
      { type: 'directional', position: [4.5, 6.5, -4.5], intensity: 2.7, color: '#ffffff', castShadow: true, mapSize: 2048 },
      { type: 'directional', position: [-5, 3.5, 4], intensity: 0.9, color: '#dbeafe' },
      { type: 'directional', position: [0, 4.5, 6], intensity: 1.35, color: '#ffffff' },
    ],
  },
  fog: { enabled: false, color: '#0b0e14', near: 8, far: 34 },
  stage: {
    backgroundColor: '#0b0e14',
    shadows: true,
    radialFloorEnabled: true,
    radialFloorColor: '#9aa8bf',
    radialFloorOpacity: 0.42,
    radialFloorInner: 0.14,
    radialFloorOuter: 1.08,
    shadowOpacity: 0.52,
    shadowCatcherOpacity: 0.24,
    shadowBlur: 2.2,
    shadowFar: 8.5,
    shadowScale: 11,
    shadowResolution: 1024,
    shadowColor: '#1f2937',
    environmentIntensity: 1.18,
    backgroundIntensity: 0.75,
  },
  animation: { autoRotate: true, rotateSpeed: 0.32 },
  camera: { fov: 40, position: [5, 3, -7] },
  postprocessing: {
    enabled: true,
    glare: 0.35,
    grain: 0.06,
    vignette: 0.18,
    exposure: 1.08,
    contrast: 1.08,
    saturation: 1.04,
    bloomThreshold: 0.62,
    bloomIntensity: 0.32,
    sharpness: 0.1,
    chromaticAberration: 0.0007,
  },
}

function normalizeDemoSnapshot(config) {
  const safe = config && typeof config === 'object' && !Array.isArray(config) ? config : {}
  return {
    ...DEFAULT_DEMO_SNAPSHOT,
    ...safe,
    model: { ...DEFAULT_DEMO_SNAPSHOT.model, ...(safe.model ?? {}) },
    runtimeAssets: Array.isArray(safe.runtimeAssets) ? safe.runtimeAssets : [],
    textureAssets: Array.isArray(safe.textureAssets) ? safe.textureAssets : [],
    materials: Array.isArray(safe.materials) ? safe.materials : [],
    parts: Array.isArray(safe.parts) ? safe.parts : [],
  }
}

async function loadDemoSnapshot() {
  const res = await fetch(`${DEMO_CONFIG_URL}?v=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) return normalizeDemoSnapshot({})

  const raw = await res.text()
  if (!raw.trim()) return normalizeDemoSnapshot({})
  return normalizeDemoSnapshot(JSON.parse(raw))
}

/**
 * /frame/[slug] — Embeddable iframe viewer.
 * Loads published snapshot from API, renders the 3D car with interactions.
 *
 * Special case: slug "demo" bypasses the backend entirely and loads the
 * static landing-demo snapshot from /public/demo/demo-config.json so the
 * landing page can iframe `/frame/demo` without ever hitting Supabase.
 */
export default function FramePage() {
  const { slug } = useParams()
  const [snapshot, setSnapshot] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!slug) return
      ; (async () => {
        try {
          if (slug === DEMO_SLUG) {
            // `no-store` + a cache-busting query param: the demo JSON is the
            // single source of truth for the landing iframe and gets rewritten
            // by the local editor. force-cache was serving stale snapshots
            // even after a save, so the model loaded but parts/normalization
            // never reflected the latest config.
            const config = await loadDemoSnapshot()
            setSnapshot(config)
            setProjectName('AutoZ Demo')
            return
          }

          const res = await fetch(`/api/project/${slug}`)
          const json = await res.json()
          if (!res.ok) throw new Error(json.error || 'Failed to load')
          setSnapshot(json.publish.snapshot)
          setProjectName(json.publish.projectName)
        } catch (err) {
          setError(err.message)
        } finally {
          setLoading(false)
        }
      })()
  }, [slug])

  if (error) {
    return (
      <div className='frame-root'>
        <div className='frame-error'>{error}</div>
      </div>
    )
  }

  return (
    <div className='frame-root'>
      {loading && (
        <div className='frame-loading'>
          <div className='frame-spinner' />
          <div>Loading 3D viewer…</div>
        </div>
      )}

      {snapshot && <FrameCanvas snapshot={snapshot} />}

      {/* Watermark */}
      <a
        className='frame-watermark'
        href='https://tryautoz.vercel.app'
        target='_blank'
        rel='noopener noreferrer'
        title='Powered by AutoZ Engine'
      >
        <span className='frame-watermark-dot' />
        <span>made in AutoZ</span>
      </a>
    </div>
  )
}
