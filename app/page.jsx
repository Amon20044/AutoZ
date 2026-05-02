'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  BadgeCheck,
  ChartNoAxesColumnIncreasing,
  Cloud,
  DoorOpen,
  FileCheck,
  Globe2,
  Lightbulb,
  MousePointerClick,
  Palette,
  Paperclip,
  Rocket,
  Ruler,
  Settings,
  TimerReset,
  Upload,
} from 'lucide-react'

const PROBLEMS = [
  { num: '01 / 04', title: 'Custom-coded viewers per car model', body: 'Every new vehicle requires bespoke Three.js work from scratch. Interactions, lighting, camera — all re-engineered every time.', cost: 'Avg. 8–12 weeks of dev time per vehicle' },
  { num: '02 / 04', title: 'Raw 3D models are a mess', body: 'Imported GLBs arrive in wrong units, wrong scale, facing the wrong direction, merged into one mesh.', cost: 'Days lost on normalization alone' },
  { num: '03 / 04', title: 'Interactivity requires a 3D engineer', body: 'Opening a door, toggling headlights, changing body color — each interaction is hand-coded with pivot math and damping curves.', cost: 'Non-technical teams completely blocked' },
  { num: '04 / 04', title: 'Nothing embeds cleanly', body: "Existing 3D tools aren't built for stable, reproducible iframe publishing. A config change breaks every embed.", cost: 'Zero publish immutability guarantees' },
]

const STEPS = [
  { num: '01', icon: Upload, label: 'Step one', title: 'Upload & normalize your model', body: 'Drop a GLB or GLTF. AutoZ runs the full normalization pipeline — unit conversion, centering, ground alignment, forward direction correction.', time: 'Under 60 seconds from upload to normalized preview' },
  { num: '02', icon: Settings, label: 'Step two', title: 'Tag parts & configure interactions', body: 'Click any mesh to assign it as a door, bonnet, headlight, or body panel. Set pivot presets. Configure open/close angles — all without code.', time: 'Full car setup in under 10 minutes' },
  { num: '03', icon: FileCheck, label: 'Step three', title: 'Publish an immutable iframe', body: 'Every setting — lighting, reflections, HDRI, camera — is frozen into an immutable snapshot. Embed it anywhere with one line of code.', time: 'Publish in under 10 seconds' },
]

const FEATURES = [
  { icon: Ruler, title: 'Automatic model normalization', body: 'Converts any GLB to a canonical coordinate system — correct scale, centered, grounded, front-facing.', proof: 'Formula-driven: unit → scale → center → direction' },
  { icon: DoorOpen, title: 'Hinge-accurate door animations', body: 'Normal, suicide, gullwing, scissor — each uses Rodrigues rotation with exponential damping.', proof: 'λ=8 damping, 65° open, 0° close. Configurable.' },
  { icon: Lightbulb, title: 'Emissive light toggle system', body: 'Headlights, taillights, DRLs, and indicators all support smooth intensity transitions.', proof: 'Emissive intensity interpolation per frame delta' },
  { icon: Palette, title: 'Body color & material variants', body: 'Unlimited color variants with car-paint PBR properties — metalness, roughness, clearcoat.', proof: 'lerp(C_current, C_target, 1 − e^−λΔt)' },
  { icon: Globe2, title: 'HDRI lighting & studio reflections', body: 'Upload your own HDR environment or choose from presets. Per-material reflection multipliers.', proof: 'envMapIntensity × material multiplier per part' },
  { icon: ChartNoAxesColumnIncreasing, title: 'Adaptive quality & GPU budgets', body: 'AutoZ monitors FPS and adjusts DPR, shadow resolution, and post-processing automatically.', proof: '<15MB GLB · <120 draw calls · <500k triangles' },
  { icon: Cloud, title: 'Hybrid asset storage', body: '3D runtime assets go to Supabase Storage. Image-like assets go to ImgBB. All URLs tracked in Postgres.', proof: 'Runtime-critical → Supabase. Visual-only → ImgBB.' },
  { icon: MousePointerClick, title: '3D radial button system', body: 'Contextual controls appear radially around clicked parts, facing the camera at all times.', proof: 'B_i = A + r_b(cos(φ_i)R_c + sin(φ_i)U_c)' },
  { icon: Paperclip, title: 'Immutable iframe publishing', body: 'Every publish creates a frozen snapshot version. The URL always renders exactly what was published.', proof: 'Draft = editable. Published snapshot = frozen.' },
]

const METRICS = [
  { num: '<2.5', unit: 's', label: 'iframe cold\nload time' },
  { num: '60', unit: 'fps', label: 'Desktop\ntarget' },
  { num: '<15', unit: 'MB', label: 'Optimized\nGLB size' },
  { num: '100', unit: '%', label: 'Publish\nreproducibility' },
]

const TECH = ['Three.js', 'React Three Fiber', 'Supabase', 'glTF-Transform', 'KTX2 / Draco', 'GSAP', 'Next.js', 'Zustand']

export default function LandingPage() {
  const rootRef = useRef(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const els = root.querySelectorAll('.lreveal')
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible') })
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' })
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  return (
    <div className='landing-root' ref={rootRef}>
      {/* NAV */}
      <nav className='lnav'>
        <Link href='/' className='lnav-logo'>
          <span className='lnav-dot' />
          AutoZ Engine
        </Link>
        <ul className='lnav-links'>
          <li><a href='#how'>How it works</a></li>
          <li><a href='#features'>Features</a></li>
          <li><a href='#metrics'>Performance</a></li>
          <li><Link href='/editor' className='lnav-cta'>Open Editor</Link></li>
        </ul>
      </nav>

      {/* HERO */}
      <section className='lhero'>
        <div className='lhero-grid' />
        <div className='lhero-glow' />
        <div className='lhero-left'>
          <div className='lhero-eyebrow'>Config-driven 3D Automotive Engine</div>
          <h1 className='lhero-h1'>
            Any Car Model.
            <em>Production-ready</em>
            In Minutes.
          </h1>
          <p className='lhero-sub'>
            Upload a vehicle model, normalize it, configure doors, lights, colors and camera — then <strong>publish an interactive 3D experience as an iframe</strong>. No custom viewer engineering.
          </p>
          <div className='lhero-actions'>
            <Link href='/editor' className='btn-p'>
              Open Editor <ArrowRight size={16} aria-hidden='true' className='arrow' />
            </Link>
            <Link href='/editor' className='btn-p btn-editor'>
              Launch Studio <Rocket size={16} aria-hidden='true' className='arrow' />
            </Link>
            <a href='#how' className='btn-g'>See how it works</a>
          </div>
          <div className='lstats'>
            {[['<2.5s', 'iframe load time'], ['60fps', 'Desktop target'], ['100%', 'Publish reproducibility'], ['<10min', 'Setup to publish']].map(([n, l]) => (
              <div key={l}><div className='stat-n'>{n}</div><div className='stat-l'>{l}</div></div>
            ))}
          </div>
        </div>
        <div className='lhero-right'>
          <iframe
            src='https://auto-z-omega.vercel.app/frame/az-20aa774ed5'
            style={{
              width: '100%',
              height: '100%',
              minHeight: '800px',
              border: 'none',
              borderRadius: '12px',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
            }}
            allow='accelerometer; ambient-light-sensor; camera; encrypted-media; geolocation; gyroscope; magnetometer; microphone; payment; usb; xr-spatial-tracking'
            allowFullScreen
            title='AutoZ Car Viewer'
          />
        </div>
      </section>

      {/* TECH STRIP */}
      <div className='tstrip'>
        <span className='tstrip-label'>Powered by</span>
        <div className='tstrip-items'>
          {TECH.map(t => <span key={t} className='tstrip-item'>{t}</span>)}
        </div>
      </div>

      {/* PROBLEM */}
      <section className='lsection lreveal' style={{ background: 'var(--c-bg)', borderTop: '1px solid var(--c-border)', borderBottom: '1px solid var(--c-border)' }}>
        <div className='slabel'>The problem</div>
        <div className='prob-grid'>
          <div>
            <h2 className='stitle'>3D Car Experiences<br />Are Broken.</h2>
            <p className='ssub'>Automotive brands need premium interactive 3D for every digital touchpoint. But today, getting there requires months, six-figure budgets, and a dedicated engineering team.</p>
          </div>
          <div className='prob-cards'>
            {PROBLEMS.map(p => (
              <div key={p.num} className='prob-card'>
                <div className='prob-card-num'>{p.num}</div>
                <div className='prob-card-t'>{p.title}</div>
                <div className='prob-card-b'>{p.body}</div>
                <div className='prob-card-c'>{p.cost}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className='lsection lreveal' id='how' style={{ background: 'var(--c-bg2)' }}>
        <div className='slabel'>How it works</div>
        <h2 className='stitle'>Upload. Configure.<br />Publish.</h2>
        <div className='steps'>
          {STEPS.map(s => (
            <div key={s.num} className='step'>
              {(() => {
                const StepIcon = s.icon
                return <div className='step-icon'><StepIcon size={26} strokeWidth={1.8} aria-hidden='true' /></div>
              })()}
              <div className='step-num'>{s.num}</div>
              <div className='step-label'>{s.label}</div>
              <div className='step-t'>{s.title}</div>
              <div className='step-b'>{s.body}</div>
              <div className='step-time'><TimerReset size={14} strokeWidth={2} aria-hidden='true' /> {s.time}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section className='lsection lreveal' id='features'>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4rem', alignItems: 'end', marginBottom: '4rem' }}>
          <div>
            <div className='slabel'>What you get</div>
            <h2 className='stitle'>Everything.<br />One Config.</h2>
          </div>
          <p className='ssub'>AutoZ replaces months of bespoke Three.js engineering with a declarative configuration layer. The entire 3D experience is driven by a single saved JSON snapshot.</p>
        </div>
        <div className='feat-grid'>
          {FEATURES.map(f => (
            <div key={f.title} className='feat-card'>
              {(() => {
                const FeatureIcon = f.icon
                return <span className='feat-icon'><FeatureIcon size={22} strokeWidth={1.9} aria-hidden='true' /></span>
              })()}
              <div className='feat-t'>{f.title}</div>
              <div className='feat-b'>{f.body}</div>
              <div className='feat-p'>{f.proof}</div>
            </div>
          ))}
        </div>
      </section>

      {/* METRICS */}
      <section className='lsection lreveal' id='metrics'>
        <div className='slabel'>Performance targets</div>
        <h2 className='stitle'>Built For<br />Production.</h2>
        <div className='met-grid'>
          {METRICS.map(m => (
            <div key={m.label} className='met-card'>
              <div className='met-n'>{m.num}<span className='met-u'>{m.unit}</span></div>
              <div className='met-l' style={{ whiteSpace: 'pre-line' }}>{m.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className='lsection lcta lreveal'>
        <div className='lcta-glow' />
        <div className='slabel' style={{ justifyContent: 'center' }}>Get started</div>
        <h2 className='stitle' style={{ textAlign: 'center' }}>
          Any Car.<br />
          <em style={{ fontStyle: 'normal', color: 'var(--c-gold)' }}>Production-Ready.</em><br />
          No Engineers.
        </h2>
        <p className='ssub' style={{ textAlign: 'center', maxWidth: 480, margin: '0 auto 2.5rem' }}>
          Upload your first GLB and publish a live interactive 3D embed in under 10 minutes.
        </p>
        <div className='lcta-actions'>
          <Link href='/editor' className='btn-p'>Open Editor <ArrowRight size={16} aria-hidden='true' className='arrow' /></Link>
          <a href='#how' className='btn-g'>Book a live demo</a>
        </div>
        <div className='lcta-trust'>
          {['Works in any browser', 'No SDK or app install', 'Publish in under 10 minutes'].map(t => (
            <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <BadgeCheck size={14} strokeWidth={2} aria-hidden='true' style={{ color: 'var(--c-gold)', opacity: 0.7 }} /> {t}
            </span>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer className='lfoot'>
        <div className='lfoot-logo'>AutoZ Engine</div>
        <div className='lfoot-copy'>© 2026 AutoZ · Config-driven 3D automotive visualization · Built on Three.js + Supabase</div>
      </footer>
    </div>
  )
}
