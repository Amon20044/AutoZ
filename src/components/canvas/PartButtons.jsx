'use client'

import { Html } from '@react-three/drei'

/** Part category → icon */
const ICONS = {
  door: '🚪', bonnet: '🔧', trunk: '📦', light: '💡',
  wheel: '⚙️', mirror: '🪞', glass: '🪟', cap: '⛽',
  spoiler: '🏎️', body: '🎨', default: '⚡',
}

/**
 * Floating 3D HTML buttons above each detected interactive part.
 *
 * @param {{ parts: PartEntry[], onToggle: (partId: string) => void }} props
 */
export default function PartButtons({ parts = [], onToggle }) {
  return (
    <>
      {parts.map((part) => {
        if (!part.anchor || !part.visibleInUI) return null

        const isActive = part.currentState === 'open' || part.currentState === 'on'
        const icon = ICONS[part.category] ?? ICONS.default

        return (
          <Html
            key={part.id}
            position={part.anchor.toArray ? part.anchor.toArray() : part.anchor}
            center
            distanceFactor={8}
            style={{ pointerEvents: 'auto' }}
            zIndexRange={[50, 0]}
          >
            <button
              className={`az-3d-btn ${isActive ? 'az-3d-btn--active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggle?.(part.id) }}
              title={`${part.label}: ${isActive ? 'Active' : 'Inactive'}`}
            >
              <span className={`az-3d-btn-dot ${isActive ? '' : 'az-3d-btn-dot--off'}`} />
              <span>{icon}</span>
              <span>{part.label}</span>
            </button>
          </Html>
        )
      })}
    </>
  )
}
