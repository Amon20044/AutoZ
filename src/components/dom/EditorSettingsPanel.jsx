'use client'

import { useState } from 'react'
import {
  Building2,
  ChevronDown,
  Circle,
  Clapperboard,
  CloudFog,
  Globe2,
  Hotel,
  House,
  Lightbulb,
  LoaderCircle,
  MapPinHouse,
  Moon,
  Send,
  SlidersHorizontal,
  Sunrise,
  Sunset,
  Trees,
  Warehouse,
} from 'lucide-react'

/** Available HDRI presets from drei */
const HDRI_PRESETS = [
  { id: 'studio', label: 'Studio', icon: Clapperboard, desc: 'Soft studio lighting' },
  { id: 'sunset', label: 'Sunset', icon: Sunset, desc: 'Warm golden hour' },
  { id: 'dawn', label: 'Dawn', icon: Sunrise, desc: 'Cool morning light' },
  { id: 'night', label: 'Night', icon: Moon, desc: 'Dark showroom' },
  { id: 'warehouse', label: 'Warehouse', icon: Warehouse, desc: 'Industrial space' },
  { id: 'forest', label: 'Forest', icon: Trees, desc: 'Natural outdoor' },
  { id: 'apartment', label: 'Apartment', icon: House, desc: 'Interior space' },
  { id: 'city', label: 'City', icon: Building2, desc: 'Urban reflections' },
  { id: 'park', label: 'Park', icon: MapPinHouse, desc: 'Open park' },
  { id: 'lobby', label: 'Lobby', icon: Hotel, desc: 'Hotel lobby' },
]

/** Studio background presets */
const STAGE_COLORS = [
  { id: 'warm-white', color: '#f7f7f4', label: 'Warm White' },
  { id: 'white', color: '#ffffff', label: 'White' },
  { id: 'gallery', color: '#ececea', label: 'Gallery' },
  { id: 'mist', color: '#d8dde2', label: 'Mist' },
  { id: 'graphite', color: '#34373a', label: 'Graphite' },
  { id: 'charcoal', color: '#181a1d', label: 'Charcoal' },
]

/**
 * Right-side settings panel — Canva-style controls for environment, lighting, fog, platform.
 *
 * @param {{ config: object, onChange: (key: string, value: any) => void, onPublish: () => void, isPublishing: boolean, publishId?: string, publishIdError?: string, isAllocatingPublishId?: boolean, publishProgress?: object[], uploadProgress?: object | null }} props
 */
export default function EditorSettingsPanel({
  config,
  onChange,
  onPublish,
  isPublishing = false,
  publishId = '',
  publishIdError = null,
  isAllocatingPublishId = false,
  publishProgress = [],
  uploadProgress = null,
}) {
  const [expandedSection, setExpandedSection] = useState('environment')

  const toggle = (s) => setExpandedSection((prev) => prev === s ? null : s)

  const env = config.environment ?? { preset: 'studio', background: false, backgroundColor: '#f7f7f4' }
  const lighting = config.lighting ?? { ambient: { enabled: true, intensity: 0.35 }, lights: [] }
  const fog = config.fog ?? { enabled: false, color: '#f7f7f4', near: 8, far: 34 }
  const stage = config.stage ?? { backgroundColor: '#f7f7f4', shadows: true, shadowOpacity: 0.34, shadowBlur: 2.8, environmentIntensity: 1.18 }
  const animation = config.animation ?? { autoRotate: false, rotateSpeed: 0.35 }
  const post = config.postprocessing ?? { enabled: true, glare: 0.35, grain: 0.06, vignette: 0.16, exposure: 1.08, contrast: 1.08, saturation: 1.04, bloomIntensity: 0.32, sharpness: 0.1 }
  const showPublishProgress = isPublishing || publishProgress.some((step) => step.status !== 'pending')

  return (
    <div className='az-panel-right'>
      {/* Publish Button */}
      <div className='az-panel-section' style={{ borderBottom: '1px solid var(--az-border)' }}>
        <button
          className='az-btn az-btn--primary'
          style={{ width: '100%', justifyContent: 'center', padding: '10px 16px', fontSize: 14 }}
          onClick={onPublish}
          disabled={isPublishing || isAllocatingPublishId}
        >
          {isPublishing
            ? (
              <>
                <LoaderCircle size={15} strokeWidth={2.2} aria-hidden='true' className='az-icon-spin' />
                <span>Publishing...</span>
              </>
            )
            : (
              <>
                <Send size={15} strokeWidth={2.2} aria-hidden='true' />
                <span>Publish</span>
              </>
            )}
        </button>
        <div className='az-publish-state'>
          <div className='az-publish-id-row'>
            <span>URL ID</span>
            <code>{isAllocatingPublishId ? 'creating...' : publishId || 'unavailable'}</code>
          </div>
          {publishIdError && (
            <div className='az-publish-id-error'>{publishIdError}</div>
          )}
          {showPublishProgress && (
            <div className='az-publish-progress' role='status' aria-live='polite'>
              {publishProgress.map((step) => (
                <div key={step.id} className={`az-publish-progress-step az-publish-progress-step--${step.status}`}>
                  <span className='az-publish-progress-dot' />
                  <span>{step.label}</span>
                </div>
              ))}
            </div>
          )}
          {uploadProgress && (
            <UploadProgressPanel progress={uploadProgress} />
          )}
        </div>
      </div>

      {/* ─── Environment / HDRI ──────────────────────────────────────── */}
      <SectionHeader
        title='Environment'
        icon={Globe2}
        expanded={expandedSection === 'environment'}
        onClick={() => toggle('environment')}
      />
      {expandedSection === 'environment' && (
        <div className='az-settings-body'>
          <div className='az-hdri-grid'>
            {HDRI_PRESETS.map((h) => (
              <HdriPresetButton
                key={h.id}
                preset={h}
                active={env.preset === h.id}
                onClick={() => onChange('environment', { ...env, preset: h.id })}
              />
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
        icon={Lightbulb}
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
            label='Light Intensity'
            value={lighting.intensity ?? 1}
            min={0.2} max={2.5} step={0.05}
            onChange={(v) => onChange('lighting', { ...lighting, intensity: v })}
          />
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
        icon={CloudFog}
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
        title='Stage'
        icon={Circle}
        expanded={expandedSection === 'stage'}
        onClick={() => toggle('stage')}
      />
      {expandedSection === 'stage' && (
        <div className='az-settings-body'>
          <label className='az-toggle-row'>
            <span>Studio Shadows</span>
            <input
              type='checkbox'
              checked={stage.shadows ?? true}
              onChange={(e) => onChange('stage', { ...stage, shadows: e.target.checked })}
            />
          </label>
          <label className='az-toggle-row'>
            <span>Auto-Rotate</span>
            <input
              type='checkbox'
              checked={animation.autoRotate ?? false}
              onChange={(e) => onChange('animation', { ...animation, autoRotate: e.target.checked })}
            />
          </label>
          <SliderRow
            label='Rotate Speed'
            value={animation.rotateSpeed ?? 0.35}
            min={0} max={2} step={0.05}
            onChange={(v) => onChange('animation', { ...animation, rotateSpeed: v })}
          />
          <div className='az-color-row'>
            <span>Background</span>
            <input
              type='color'
              value={stage.backgroundColor ?? '#f7f7f4'}
              onChange={(e) => {
                const backgroundColor = e.target.value
                onChange('stage', { ...stage, backgroundColor })
                onChange('environment', { ...env, backgroundColor })
                if (fog.enabled) onChange('fog', { ...fog, color: backgroundColor })
              }}
            />
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--az-text-dim)', marginBottom: 6 }}>Background Presets</div>
            <div className='az-color-swatch-row'>
              {STAGE_COLORS.map((c) => (
                <button
                  key={c.id}
                  className={`az-color-swatch ${stage.backgroundColor === c.color ? 'az-color-swatch--active' : ''}`}
                  style={{ background: c.color }}
                  onClick={() => {
                    onChange('stage', { ...stage, backgroundColor: c.color })
                    onChange('environment', { ...env, backgroundColor: c.color })
                    if (fog.enabled) onChange('fog', { ...fog, color: c.color })
                  }}
                  title={c.label}
                />
              ))}
            </div>
          </div>
          <SliderRow
            label='Reflection'
            value={stage.environmentIntensity ?? 1.18}
            min={0} max={2.5} step={0.05}
            onChange={(v) => onChange('stage', { ...stage, environmentIntensity: v })}
          />
          <SliderRow
            label='Shadow Opacity'
            value={stage.shadowOpacity ?? 0.34}
            min={0} max={0.8} step={0.02}
            onChange={(v) => onChange('stage', { ...stage, shadowOpacity: v })}
          />
          <SliderRow
            label='Shadow Softness'
            value={stage.shadowBlur ?? 2.8}
            min={0.5} max={6} step={0.1}
            onChange={(v) => onChange('stage', { ...stage, shadowBlur: v })}
          />
        </div>
      )}

      <SectionHeader
        title='Post FX'
        icon={SlidersHorizontal}
        expanded={expandedSection === 'postprocessing'}
        onClick={() => toggle('postprocessing')}
      />
      {expandedSection === 'postprocessing' && (
        <div className='az-settings-body'>
          <label className='az-toggle-row'>
            <span>Enable Effects</span>
            <input
              type='checkbox'
              checked={post.enabled ?? true}
              onChange={(e) => onChange('postprocessing', { ...post, enabled: e.target.checked })}
            />
          </label>
          <SliderRow
            label='Glare'
            value={post.glare ?? 0.35}
            min={0} max={2} step={0.05}
            onChange={(v) => onChange('postprocessing', { ...post, glare: v })}
          />
          <SliderRow
            label='Grain'
            value={post.grain ?? 0.04}
            min={0} max={0.4} step={0.01}
            onChange={(v) => onChange('postprocessing', { ...post, grain: v })}
          />
          <SliderRow
            label='Vignette'
            value={post.vignette ?? 0.16}
            min={0} max={1} step={0.02}
            onChange={(v) => onChange('postprocessing', { ...post, vignette: v })}
          />
          <SliderRow
            label='Exposure'
            value={post.exposure ?? 1.1}
            min={0.5} max={1.8} step={0.05}
            onChange={(v) => onChange('postprocessing', { ...post, exposure: v })}
          />
          <SliderRow
            label='Contrast'
            value={post.contrast ?? 1}
            min={0.5} max={1.8} step={0.05}
            onChange={(v) => onChange('postprocessing', { ...post, contrast: v })}
          />
          <SliderRow
            label='Saturation'
            value={post.saturation ?? 1}
            min={0.2} max={1.8} step={0.05}
            onChange={(v) => onChange('postprocessing', { ...post, saturation: v })}
          />
          <SliderRow
            label='Bloom'
            value={post.bloomIntensity ?? 0.32}
            min={0} max={1} step={0.02}
            onChange={(v) => onChange('postprocessing', { ...post, bloomIntensity: v })}
          />
          <SliderRow
            label='Sharpness'
            value={post.sharpness ?? 0.1}
            min={0} max={0.4} step={0.01}
            onChange={(v) => onChange('postprocessing', { ...post, sharpness: v })}
          />
        </div>
      )}
    </div>
  )
}

// ─── Reusable Subcomponents ──────────────────────────────────────────────────

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function formatBytes(bytes = 0) {
  if (!bytes) return '0 MB'

  const mb = bytes / 1024 / 1024
  if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`

  return `${(mb / 1024).toFixed(2)} GB`
}

function getChunkLabel(part) {
  const number = String((part?.index ?? 0) + 1).padStart(3, '0')
  return `Part ${number}`
}

function UploadProgressPanel({ progress }) {
  const percent = clampPercent(progress.percent)
  const parts = progress.parts ?? []
  const currentPart = typeof progress.currentPart === 'number'
    ? parts[progress.currentPart]
    : parts.find((part) => part.status === 'running')
  const currentPercent = clampPercent(currentPart?.percent ?? 0)
  const statusText = progress.statusText || (
    progress.phase === 'done'
      ? 'Upload complete'
      : progress.phase === 'manifest'
        ? 'Writing manifest.json'
        : 'Uploading model chunks'
  )

  return (
    <div className='az-upload-progress'>
      <div className='az-upload-progress-head'>
        <div>
          <div className='az-upload-progress-title'>{progress.fileName || 'Model upload'}</div>
          <div className='az-upload-progress-sub'>{statusText}</div>
        </div>
        <strong>{percent}%</strong>
      </div>

      <ProgressBar value={percent} className='az-upload-progress-bar' />

      <div className='az-upload-progress-meta'>
        <span>{formatBytes(progress.uploadedBytes)} / {formatBytes(progress.totalBytes)}</span>
        <span>{progress.completedParts ?? 0} / {progress.totalParts ?? parts.length} parts</span>
      </div>

      {currentPart && (
        <div className='az-upload-current'>
          <div className='az-upload-current-row'>
            <span>{getChunkLabel(currentPart)}</span>
            <span>{currentPercent}%</span>
          </div>
          <ProgressBar value={currentPercent} className='az-upload-current-bar' />
        </div>
      )}

      {parts.length > 0 && (
        <div className='az-upload-parts' aria-label='Upload parts'>
          {parts.map((part) => (
            <div key={part.index} className={`az-upload-part az-upload-part--${part.status}`}>
              <span className='az-upload-part-label'>{String(part.index + 1).padStart(2, '0')}</span>
              <ProgressBar value={part.percent} className='az-upload-part-bar' />
              <span className='az-upload-part-state'>{part.cached ? 'cached' : part.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProgressBar({ value, className = '' }) {
  return (
    <div className={`az-progress-bar ${className}`}>
      <span style={{ width: `${clampPercent(value)}%` }} />
    </div>
  )
}

function HdriPresetButton({ preset, active, onClick }) {
  const Icon = preset.icon

  return (
    <button
      className={`az-hdri-card ${active ? 'az-hdri-card--active' : ''}`}
      onClick={onClick}
      title={preset.desc}
    >
      <span className='az-hdri-icon'>
        <Icon size={17} strokeWidth={2.1} aria-hidden='true' />
      </span>
      <span className='az-hdri-label'>{preset.label}</span>
    </button>
  )
}

function SectionHeader({ title, icon, expanded, onClick }) {
  const Icon = icon

  return (
    <button className='az-settings-header' onClick={onClick}>
      <span className='az-settings-header-label'>
        <Icon size={13} strokeWidth={2.2} aria-hidden='true' />
        <span>{title}</span>
      </span>
      <ChevronDown
        size={14}
        strokeWidth={2.2}
        aria-hidden='true'
        style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 200ms' }}
      />
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
