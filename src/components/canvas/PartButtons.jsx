'use client'

import { Html } from '@react-three/drei'
import {
  Car,
  Disc3,
  DoorOpen,
  Fuel,
  Gauge,
  GlassWater,
  Lightbulb,
  Palette,
  PackageOpen,
  ScanLine,
  Shield,
  Sparkles,
  Wrench,
} from 'lucide-react'

const ICONS = {
  door: DoorOpen,
  bonnet: Wrench,
  trunk: PackageOpen,
  light: Lightbulb,
  wheel: Disc3,
  rim: Gauge,
  mirror: ScanLine,
  glass: GlassWater,
  cap: Fuel,
  spoiler: Sparkles,
  body: Palette,
  bumper: Shield,
  default: Car,
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
        const Icon = ICONS[part.category] ?? ICONS.default

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
              <Icon size={14} strokeWidth={2.2} aria-hidden='true' />
              <span>{part.label}</span>
            </button>
          </Html>
        )
      })}
    </>
  )
}
