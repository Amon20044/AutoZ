'use client'

import { useEffect, useRef, useState } from 'react'
import { processingBus } from '@/engine/pipeline/processing-bus'

/**
 * Live scrolling event log — subscribes to processingBus 'step' events.
 */
export default function ProcessingLog() {
  const [entries, setEntries] = useState([])
  const scrollRef = useRef(null)

  useEffect(() => {
    const unsub = processingBus.on('step', (entry) => {
      setEntries((prev) => {
        // Replace existing entry with same id, or append
        const idx = prev.findIndex((e) => e.id === entry.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = entry
          return next
        }
        return [...prev, entry]
      })
    })
    return unsub
  }, [])

  // Auto-scroll on new entry
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries])

  if (entries.length === 0) {
    return (
      <div className='p-4 text-center' style={{ color: 'var(--az-text-dim)', fontSize: 12 }}>
        Upload a model to begin processing…
      </div>
    )
  }

  return (
    <div ref={scrollRef} className='az-panel-scroll'>
      <div className='az-log'>
        {entries.map((e, i) => (
          <div key={`${e.id}-${i}`} className='az-log-entry'>
            <div className={`az-log-dot az-log-dot--${e.status}`} />
            <div className='az-log-content'>
              <div className='az-log-label'>{e.label}</div>
              {e.detail && <div className='az-log-detail'>{e.detail}</div>}
            </div>
            <div className='az-log-time'>
              {e.elapsed < 1000 ? `${e.elapsed}ms` : `${(e.elapsed / 1000).toFixed(1)}s`}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
