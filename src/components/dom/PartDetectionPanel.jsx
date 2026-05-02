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

export default function PartDetectionPanel({
  parts = [],
  activePart = null,
  onPartClick,
  onToggle,
  onPartConfigChange,
}) {
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
            <div className='az-part-card-main'>
              <div className='az-part-icon'>
                <Icon size={16} strokeWidth={2.1} aria-hidden='true' />
              </div>
              <div className='az-part-info'>
                <div className='az-part-name'>{part.label}</div>
                <div className='az-part-meta'>
                  {part.typeKey} &middot; {part.meshNames?.[0] ?? '-'}
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

            {isActive && (
              <PartMotionControls
                part={part}
                onChange={(patch) => onPartConfigChange?.(part.id, patch)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return '0'
  return Number(value.toFixed(digits)).toString()
}

function radToDeg(value) {
  return (Number.isFinite(value) ? value : 0) * 180 / Math.PI
}

function vectorToArray(vector) {
  if (vector?.toArray) return vector.toArray()
  if (Array.isArray(vector)) return vector
  return [0, 0, 0]
}

function NumberInput({ label, value, step = 0.1, onChange }) {
  return (
    <label className='az-part-field' onClick={(e) => e.stopPropagation()}>
      <span>{label}</span>
      <input
        type='number'
        value={formatNumber(value)}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  )
}

function PartMotionControls({ part, onChange }) {
  const offset = vectorToArray(part.pivotOffset)
  const axis = vectorToArray(part.axis)
  const isSpin = part.interactions?.[0] === 'spin'

  const updateOffset = (index, value) => {
    if (!Number.isFinite(value)) return
    const next = [...offset]
    next[index] = value
    onChange({ pivotOffset: next })
  }

  return (
    <div className='az-part-controls' onClick={(e) => e.stopPropagation()}>
      <div className='az-part-control-grid'>
        <NumberInput
          label='Start'
          value={radToDeg(part.closeAngle)}
          step={1}
          onChange={(value) => Number.isFinite(value) && onChange({ closeAngleDeg: value })}
        />
        <NumberInput
          label='End'
          value={radToDeg(part.openAngle)}
          step={1}
          onChange={(value) => Number.isFinite(value) && onChange({ openAngleDeg: value })}
        />
      </div>

      {isSpin && (
        <NumberInput
          label='Spin Speed'
          value={part.spinSpeed ?? 5.5}
          step={0.25}
          onChange={(value) => Number.isFinite(value) && onChange({ spinSpeed: value })}
        />
      )}

      <div className='az-part-control-label'>Pivot Offset</div>
      <div className='az-part-control-grid az-part-control-grid--triple'>
        <NumberInput label='X' value={offset[0] ?? 0} step={0.01} onChange={(value) => updateOffset(0, value)} />
        <NumberInput label='Y' value={offset[1] ?? 0} step={0.01} onChange={(value) => updateOffset(1, value)} />
        <NumberInput label='Z' value={offset[2] ?? 0} step={0.01} onChange={(value) => updateOffset(2, value)} />
      </div>

      <div className='az-part-axis'>
        Axis {axis.map((value) => formatNumber(value, 2)).join(', ')}
      </div>
    </div>
  )
}
