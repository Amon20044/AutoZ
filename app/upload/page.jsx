'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { uploadOptimizedAsset } from '@/lib/assets/upload-optimized-asset'

export default function UploadPage() {
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const [file, setFile] = useState(null)
  const [isRunning, setIsRunning] = useState(false)
  const [workerProgress, setWorkerProgress] = useState({ stage: 'idle', progress: 0, message: 'Waiting for GLB' })
  const [uploads, setUploads] = useState({})
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleFile = (event) => {
    const nextFile = event.target.files?.[0] || null
    setFile(nextFile)
    setResult(null)
    setError(null)
    setUploads({})
    setWorkerProgress({ stage: 'idle', progress: 0, message: nextFile ? nextFile.name : 'Waiting for GLB' })
  }

  const start = async () => {
    if (!file) return

    const controller = new AbortController()
    abortRef.current = controller
    setIsRunning(true)
    setError(null)
    setResult(null)
    setUploads({})

    try {
      const next = await uploadOptimizedAsset(file, {
        signal: controller.signal,
        onProgress: (event) => {
          if (event.type === 'worker') {
            setWorkerProgress({
              stage: event.stage,
              progress: Math.round((event.progress || 0) * 100),
              message: event.message,
            })
          }
          if (event.type === 'upload') {
            setUploads((prev) => ({
              ...prev,
              [event.fileKey]: {
                fileKey: event.fileKey,
                percent: event.percent,
                loaded: event.loaded,
                total: event.total,
                metadata: event.metadata,
              },
            }))
          }
        },
      })
      setResult(next)
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setIsRunning(false)
      abortRef.current = null
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    setIsRunning(false)
  }

  const uploadRows = Object.values(uploads).sort((a, b) => a.fileKey.localeCompare(b.fileKey))

  return (
    <main className='asset-upload-page'>
      <section className='asset-upload-panel'>
        <div>
          <p className='asset-upload-kicker'>AutoZ Streaming Asset Pipeline</p>
          <h1>Upload and Optimize GLB</h1>
          <p className='asset-upload-copy'>
            Processing happens in your browser. The server only creates upload URLs and stores the manifest.
          </p>
        </div>

        <input
          ref={inputRef}
          type='file'
          accept='.glb,model/gltf-binary'
          onChange={handleFile}
          hidden
        />

        <div className='asset-upload-actions'>
          <button className='az-btn' onClick={() => inputRef.current?.click()} disabled={isRunning}>
            Choose GLB
          </button>
          <button className='az-btn az-btn--primary' onClick={start} disabled={!file || isRunning}>
            {isRunning ? 'Processing' : 'Start'}
          </button>
          {isRunning && (
            <button className='az-btn' onClick={cancel}>
              Cancel
            </button>
          )}
        </div>

        {file && (
          <div className='asset-upload-file'>
            <span>{file.name}</span>
            <code>{(file.size / 1024 / 1024).toFixed(1)} MB</code>
          </div>
        )}

        <div className='asset-upload-progress-card'>
          <div className='asset-upload-progress-head'>
            <span>{workerProgress.message}</span>
            <strong>{workerProgress.progress}%</strong>
          </div>
          <div className='az-progress-bar'>
            <span style={{ width: `${workerProgress.progress}%` }} />
          </div>
          <code>{workerProgress.stage}</code>
        </div>

        {uploadRows.length > 0 && (
          <div className='asset-upload-list'>
            {uploadRows.map((row) => (
              <div key={row.fileKey} className='asset-upload-row'>
                <span>{row.fileKey}</span>
                <div className='az-progress-bar'>
                  <span style={{ width: `${row.percent || 0}%` }} />
                </div>
                <code>{row.percent || 0}%</code>
              </div>
            ))}
          </div>
        )}

        {error && <div className='asset-upload-error'>{error}</div>}

        {result && (
          <div className='asset-upload-result'>
            <span>Asset ready</span>
            <Link className='az-btn az-btn--primary' href={`/assets/${result.assetId}`}>
              Open Viewer
            </Link>
          </div>
        )}
      </section>
    </main>
  )
}
