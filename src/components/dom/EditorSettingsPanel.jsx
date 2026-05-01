'use client'

import { useState, useCallback } from 'react'

/** Available HDRI presets from drei */
const HDRI_PRESETS = [
  { id: 'studio', label: 'Studio', icon: '🎬', desc: 'Soft studio lighting' },
  { id: 'sunset', label: 'Sunset', icon: '🌅', desc: 'Warm golden hour' },
  { id: 'dawn', label: 'Dawn', icon: '🌄', desc: 'Cool morning light' },
  { id: 'night', label: 'Night', icon: '🌙', desc: 'Dark showroom' },
  { id: 'warehouse', label: 'Warehouse', icon: '🏭', desc: 'Industrial space' },
  { id: 'forest', label: 'Forest', icon: '🌲', desc: 'Natural outdoor' },
  { id: 'apartment', label: 'Apartment', icon: '🏠', desc: 'Interior space' },
  { id: 'city', label: 'City', icon: '🏙️', desc: 'Urban reflections' },
  { id: 'park', label: 'Park', icon: '🌳', desc: 'Open park' },
  { id: 'lobby', label: 'Lobby', icon: '🏨', desc: 'Hotel lobby' },
]

/** Platform color presets */
const PLATFORM_COLORS = [
  { id: 'silver', color: '#e0e0e0', label: 'Silver' },
  { id: 'dark', color: '#1a1a2e', label: 'Dark' },
  { id: 'white', color: '#f5f5f5', label: 'White' },
  { id: 'charcoal', color: '#2d2d3f', label: 'Charcoal' },
  { id: 'gold', color: '#c9a96e', label: 'Gold' },
  { id: 'rose', color: '#b76e79', label: 'Rose' },
]

/**
 * Right-side settings panel — Canva-style controls for environment, lighting, fog, platform.
 *
 * @param {{ config: object, onChange: (key: string, value: any) => void, onPublish: () => void, isPublishing: boolean }} props
 */
export default function EditorSettingsPanel({ config, onChange, onPublish, isPublishing = false }) {
  const [expandedSection, setExpandedSection] = useState('environment')

  const toggle = (s) => setExpandedSection((prev) => prev === s ? null : s)

  const env = config.environment ?? { preset: 'studio', background: false }
  const lighting = config.lighting ?? { ambient: { enabled: true, intensity: 0.35 }, lights: [] }
  const fog = config.fog ?? { enabled: false, color: '#0a0a0f', near: 10, far: 50 }
  const platform = config.platform ?? { enabled: true, color: '#e0e0e0', autoRotate: true, rotateSpeed: 0.12 }

  return (
    <div className='az-panel-right'>
      {/* Publish Button */}
      <div className='az-panel-section' style={{ borderBottom: '1px solid var(--az-border)' }}>
        <button
          className='az-btn az-btn--primary'
          style={{ width: '100%', justifyContent: 'center', padding: '10px 16px', fontSize: 14 }}
          onClick={onPublish}
          disabled={isPublishing}
        >
          {isPublishing ? '⏳ Publishing…' : '🚀 Publish'}
        </button>
      </div>

      {/* ─── Environment / HDRI ──────────────────────────────────────── */}
      <SectionHeader
        title='Environment'
        icon='🌍'
        expanded={expandedSection === 'environment'}
        onClick={() => toggle('environment')}
      />
      {expandedSection === 'environment' && (
        <div className='az-settings-body'>
          <div className='az-hdri-grid'>
            {HDRI_PRESETS.map((h) => (
              <button
                key={h.id}
                className={`az-hdri-card ${env.preset === h.id ? 'az-hdri-card--active' : ''}`}
                onClick={() => onChange('environment', { ...env, preset: h.id })}
                title={h.desc}
              >
                <span className='az-hdri-icon'>{h.icon}</span>
                <span className='az-hdri-label'>{h.label}</span>
              </button>
            ))}
          </div>
          <label className='az-toggle-row'>
            <span>Show as background</span>
            <input
              type='checkbox'
              checked={env.background ?? false}
              onChange={(e) => onChange('environment', { ...env, background: e.target.checked })}
            />
          </label>
        </div>
      )}

      {/* ─── Lighting ─────────────────────────────────────────────────── */}
      <SectionHeader
        title='Lighting'
        icon='💡'
        expanded={expandedSection === 'lighting'}
        onClick={() => toggle('lighting')}
      />
      {expandedSection === 'lighting' && (
        <div className='az-settings-body'>
          <label className='az-toggle-row'>
            <span>Ambient Light</span>
            <input
              type='checkbox'
              checked={lighting.ambient?.enabled ?? true}
              onChange={(e) => onChange('lighting', {
                ...lighting,
                ambient: { ...lighting.ambient, enabled: e.target.checked },
              })}
            />
          </label>
          <SliderRow
            label='Ambient Intensity'
            value={lighting.ambient?.intensity ?? 0.35}
            min={0} max={2} step={0.05}
            onChange={(v) => onChange('lighting', {
              ...lighting,
              ambient: { ...lighting.ambient, intensity: v },
            })}
          />
          <SliderRow
            label='Key Light'
            value={lighting.lights?.[0]?.intensity ?? 2.2}
            min={0} max={5} step={0.1}
            onChange={(v) => {
              const lights = [...(lighting.lights ?? [])]
              if (lights[0]) lights[0] = { ...lights[0], intensity: v }
              onChange('lighting', { ...lighting, lights })
            }}
          />
          <SliderRow
            label='Fill Light'
            value={lighting.lights?.[1]?.intensity ?? 0.8}
            min={0} max={3} step={0.1}
            onChange={(v) => {
              const lights = [...(lighting.lights ?? [])]
              if (lights[1]) lights[1] = { ...lights[1], intensity: v }
              onChange('lighting', { ...lighting, lights })
            }}
          />
          <SliderRow
            label='Rim Light'
            value={lighting.lights?.[2]?.intensity ?? 1.1}
            min={0} max={3} step={0.1}
            onChange={(v) => {
              const lights = [...(lighting.lights ?? [])]
              if (lights[2]) lights[2] = { ...lights[2], intensity: v }
              onChange('lighting', { ...lighting, lights })
            }}
          />
        </div>
      )}

      {/* ─── Fog ──────────────────────────────────────────────────────── */}
      <SectionHeader
        title='Fog'
        icon='🌫️'
        expanded={expandedSection === 'fog'}
        onClick={() => toggle('fog')}
      />
      {expandedSection === 'fog' && (
        <div className='az-settings-body'>
          <label className='az-toggle-row'>
            <span>Enable Fog</span>
            <input
              type='checkbox'
              checked={fog.enabled ?? false}
              onChange={(e) => onChange('fog', { ...fog, enabled: e.target.checked })}
            />
          </label>
          <div className='az-color-row'>
            <span>Fog Color</span>
            <input
              type='color'
              value={fog.color ?? '#0a0a0f'}
              onChange={(e) => onChange('fog', { ...fog, color: e.target.value })}
            />
          </div>
          <SliderRow
            label='Near'
            value={fog.near ?? 10}
            min={1} max={30} step={1}
            onChange={(v) => onChange('fog', { ...fog, near: v })}
          />
          <SliderRow
            label='Far'
            value={fog.far ?? 50}
            min={10} max={100} step={1}
            onChange={(v) => onChange('fog', { ...fog, far: v })}
          />
        </div>
      )}

      {/* ─── Platform ─────────────────────────────────────────────────── */}
      <SectionHeader
        title='Platform'
        icon='⚪'
        expanded={expandedSection === 'platform'}
        onClick={() => toggle('platform')}
      />
      {expandedSection === 'platform' && (
        <div className='az-settings-body'>
          <label className='az-toggle-row'>
            <span>Show Platform</span>
            <input
              type='checkbox'
              checked={platform.enabled ?? true}
              onChange={(e) => onChange('platform', { ...platform, enabled: e.target.checked })}
            />
          </label>
          <label className='az-toggle-row'>
            <span>Auto-Rotate</span>
            <input
              type='checkbox'
              checked={platform.autoRotate ?? true}
              onChange={(e) => onChange('platform', { ...platform, autoRotate: e.target.checked })}
            />
          </label>
          <SliderRow
            label='Rotate Speed'
            value={platform.rotateSpeed ?? 0.12}
            min={0} max={1} step={0.02}
            onChange={(v) => onChange('platform', { ...platform, rotateSpeed: v })}
          />
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--az-text-dim)', marginBottom: 6 }}>Platform Color</div>
            <div className='az-color-swatch-row'>
              {PLATFORM_COLORS.map((c) => (
                <button
                  key={c.id}
                  className={`az-color-swatch ${platform.color === c.color ? 'az-color-swatch--active' : ''}`}
                  style={{ background: c.color }}
                  onClick={() => onChange('platform', { ...platform, color: c.color })}
                  title={c.label}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Reusable Subcomponents ──────────────────────────────────────────────────

function SectionHeader({ title, icon, expanded, onClick }) {
  return (
    <button className='az-settings-header' onClick={onClick}>
      <span>{icon} {title}</span>
      <span style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 200ms' }}>▾</span>
    </button>
  )
}

function SliderRow({ label, value, min, max, step, onChange }) {
  return (
    <div className='az-slider-row'>
      <div className='az-slider-label'>
        <span>{label}</span>
        <span className='az-slider-value'>{typeof value === 'number' ? value.toFixed(2) : value}</span>
      </div>
      <input
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className='az-slider'
      />
    </div>
  )
}
