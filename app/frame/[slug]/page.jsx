'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'

const FrameCanvas = dynamic(() => import('@/components/canvas/FrameCanvas'), { ssr: false })

/**
 * /frame/[slug] — Embeddable iframe viewer.
 * Loads published snapshot from API, renders the 3D car with interactions.
 */
export default function FramePage() {
  const { slug } = useParams()
  const [snapshot, setSnapshot] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!slug) return
    ;(async () => {
      try {
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
        href='https://autoz.dev'
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
