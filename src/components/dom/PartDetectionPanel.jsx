'use client'

import {
  Armchair,
  CircleHelp,
  Disc3,
  DoorOpen,
  Fuel,
  Gauge,
  GlassWater,
  Lightbulb,
  PackageOpen,
  Palette,
  PanelTop,
  Play,
  ScanLine,
  Shield,
  Sparkles,
  Sun,
  Wrench,
  X,
} from 'lucide-react'

const PART_ICONS = {
  body: Palette,
  door: DoorOpen,
  bonnet: Wrench,
  trunk: PackageOpen,
  light: Lightbulb,
  wheel: Disc3,
  rim: Gauge,
  mirror: ScanLine,
  glass: GlassWater,
  roof: Sun,
  cap: Fuel,
  spoiler: Sparkles,
  bumper: Shield,
  grille: PanelTop,
  interior: Armchair,
  unknown: CircleHelp,
}

/**
 * Sidebar panel showing detected parts with confidence scores.
 *
 * @param {{ parts: PartEntry[], activePart: string|null, onPartClick: (id: string) => void, onToggle: (id: string) => void }} props
 */
export default function PartDetectionPanel({ parts = [], activePart = null, onPartClick, onToggle }) {
  if (parts.length === 0) {
    return (
      <div className='p-4 text-center' style={{ color: 'var(--az-text-dim)', fontSize: 12 }}>
        No parts detected yet.
      </div>
    )
  }

  return (
    <div className='az-panel-scroll' style={{ padding: '8px 12px' }}>
      {parts.map((part) => {
        const score = Math.round((part.detection?.score ?? 0) * 100)
        const isActive = activePart === part.id
        const isOpen = part.currentState === 'open' || part.currentState === 'on'
        const scoreClass = score >= 75 ? 'high' : score >= 50 ? 'mid' : 'low'
        const Icon = PART_ICONS[part.category] ?? PART_ICONS.unknown

        return (
          <div
            key={part.id}
            className={`az-part-card ${isActive ? 'az-part-card--active' : ''}`}
            onClick={() => onPartClick?.(part.id)}
          >
            <div className='az-part-icon'>
              <Icon size={16} strokeWidth={2.1} aria-hidden='true' />
            </div>
            <div className='az-part-info'>
              <div className='az-part-name'>{part.label}</div>
              <div className='az-part-meta'>
                {part.typeKey} &middot; {part.meshNames?.[0] ?? '–'}
              </div>
            </div>
            <span className={`az-part-score az-part-score--${scoreClass}`}>
              {score}%
            </span>
            <button
              className={`az-btn az-btn--sm ${isOpen ? 'az-btn--primary' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggle?.(part.id) }}
              title={isOpen ? 'Close / Off' : 'Open / On'}
            >
              {isOpen
                ? <X size={13} strokeWidth={2.3} aria-hidden='true' />
                : <Play size={13} strokeWidth={2.3} aria-hidden='true' />}
            </button>
          </div>
        )
      })}
    </div>
  )
}
