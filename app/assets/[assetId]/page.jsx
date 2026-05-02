'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

const ProgressiveAssetCanvas = dynamic(() => import('@/components/canvas/ProgressiveAssetCanvas'), {
  ssr: false,
})

export default function AssetViewerPage() {
  const { assetId } = useParams()
  const [manifest, setManifest] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!assetId) return
    const controller = new AbortController()

    ;(async () => {
      try {
        setLoading(true)
        const res = await fetch(`/api/assets/${assetId}/manifest`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Could not load asset manifest.')
        setManifest(json)
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message)
      } finally {
        setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [assetId])

  return (
    <main className='asset-viewer-page'>
      <div className='asset-viewer-topbar'>
        <Link href='/upload' className='az-btn'>Upload</Link>
        <span>{assetId}</span>
      </div>

      {loading && (
        <div className='asset-first-load'>
          <div className='az-spinner' />
          <span>Loading manifest</span>
        </div>
      )}

      {error && <div className='frame-error'>{error}</div>}
      {manifest && <ProgressiveAssetCanvas manifest={manifest} />}
    </main>
  )
}
