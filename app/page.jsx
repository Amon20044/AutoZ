'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'

const PROBLEMS = [
  { num: '01 / 04', title: 'Custom-coded viewers per car model', body: 'Every new vehicle requires bespoke Three.js work from scratch. Interactions, lighting, camera — all re-engineered every time.', cost: 'Avg. 8–12 weeks of dev time per vehicle' },
  { num: '02 / 04', title: 'Raw 3D models are a mess', body: 'Imported GLBs arrive in wrong units, wrong scale, facing the wrong direction, merged into one mesh.', cost: 'Days lost on normalization alone' },
  { num: '03 / 04', title: 'Interactivity requires a 3D engineer', body: 'Opening a door, toggling headlights, changing body color — each interaction is hand-coded with pivot math and damping curves.', cost: 'Non-technical teams completely blocked' },
  { num: '04 / 04', title: 'Nothing embeds cleanly', body: "Existing 3D tools aren't built for stable, reproducible iframe publishing. A config change breaks every embed.", cost: 'Zero publish immutability guarantees' },
]

const STEPS = [
  { num: '01', icon: '⬆', label: 'Step one', title: 'Upload & normalize your model', body: 'Drop a GLB or GLTF. AutoZ runs the full normalization pipeline — unit conversion, centering, ground alignment, forward direction correction.', time: 'Under 60 seconds from upload to normalized preview' },
  { num: '02', icon: '⚙', label: 'Step two', title: 'Tag parts & configure interactions', body: 'Click any mesh to assign it as a door, bonnet, headlight, or body panel. Set pivot presets. Configure open/close angles — all without code.', time: 'Full car setup in under 10 minutes' },
  { num: '03', icon: '⬡', label: 'Step three', title: 'Publish an immutable iframe', body: 'Every setting — lighting, reflections, HDRI, camera — is frozen into an immutable snapshot. Embed it anywhere with one line of code.', time: 'Publish in under 10 seconds' },
]

const FEATURES = [
  { icon: '📐', title: 'Automatic model normalization', body: 'Converts any GLB to a canonical coordinate system — correct scale, centered, grounded, front-facing.', proof: 'Formula-driven: unit → scale → center → direction' },
  { icon: '🚪', title: 'Hinge-accurate door animations', body: 'Normal, suicide, gullwing, scissor — each uses Rodrigues rotation with exponential damping.', proof: 'λ=8 damping, 65° open, 0° close. Configurable.' },
  { icon: '💡', title: 'Emissive light toggle system', body: 'Headlights, taillights, DRLs, and indicators all support smooth intensity transitions.', proof: 'Emissive intensity interpolation per frame delta' },
  { icon: '🎨', title: 'Body color & material variants', body: 'Unlimited color variants with car-paint PBR properties — metalness, roughness, clearcoat.', proof: 'lerp(C_current, C_target, 1 − e^−λΔt)' },
  { icon: '🌐', title: 'HDRI lighting & studio reflections', body: 'Upload your own HDR environment or choose from presets. Per-material reflection multipliers.', proof: 'envMapIntensity × material multiplier per part' },
  { icon: '📊', title: 'Adaptive quality & GPU budgets', body: 'AutoZ monitors FPS and adjusts DPR, shadow resolution, and post-processing automatically.', proof: '<15MB GLB · <120 draw calls · <500k triangles' },
  { icon: '☁', title: 'Hybrid asset storage', body: '3D runtime assets go to Supabase Storage. Image-like assets go to ImgBB. All URLs tracked in Postgres.', proof: 'Runtime-critical → Supabase. Visual-only → ImgBB.' },
  { icon: '🔘', title: '3D radial button system', body: 'Contextual controls appear radially around clicked parts, facing the camera at all times.', proof: 'B_i = A + r_b(cos(φ_i)R_c + sin(φ_i)U_c)' },
  { icon: '📎', title: 'Immutable iframe publishing', body: 'Every publish creates a frozen snapshot version. The URL always renders exactly what was published.', proof: 'Draft = editable. Published snapshot = frozen.' },
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
              Open Editor <span className='arrow'>→</span>
            </Link>
            <Link href='/editor' className='btn-p btn-editor'>
              Launch Studio <span className='arrow'>⟶</span>
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
          <div className='viewer-mock'>
            <div className='viewer-top'>
              <div className='vdot on' /><div className='vdot' /><div className='vdot' />
              <span className='vtitle'>autoz.app/view/sedan-red-studio-82fa</span>
            </div>
            <div className='viewer-body'>
              <div className='scanline' />
              <div style={{ width: '85%', position: 'relative' }}>
                <svg viewBox='0 0 520 200' fill='none' xmlns='http://www.w3.org/2000/svg' style={{ width: '100%', display: 'block' }}>
                  <path d='M60 130 L60 110 L120 65 L220 48 L320 50 L400 68 L440 90 L460 110 L460 130 Z' fill='rgba(200,169,110,0.06)' stroke='rgba(200,169,110,0.25)' strokeWidth='1' />
                  <path d='M130 108 L160 70 L220 54 L310 54 L370 70 L390 108 Z' fill='rgba(200,169,110,0.04)' stroke='rgba(200,169,110,0.15)' strokeWidth='1' />
                  <path d='M155 104 L178 70 L240 58 L240 104 Z' fill='rgba(120,160,190,0.08)' stroke='rgba(120,160,190,0.2)' strokeWidth='0.8' />
                  <path d='M295 104 L295 58 L355 68 L372 104 Z' fill='rgba(120,160,190,0.08)' stroke='rgba(120,160,190,0.2)' strokeWidth='0.8' />
                  <circle cx='145' cy='136' r='26' fill='rgba(10,10,10,0.9)' stroke='rgba(200,169,110,0.2)' strokeWidth='1' />
                  <circle cx='145' cy='136' r='16' fill='none' stroke='rgba(200,169,110,0.35)' strokeWidth='1.5' />
                  <circle cx='145' cy='136' r='5' fill='rgba(200,169,110,0.3)' />
                  <circle cx='375' cy='136' r='26' fill='rgba(10,10,10,0.9)' stroke='rgba(200,169,110,0.2)' strokeWidth='1' />
                  <circle cx='375' cy='136' r='16' fill='none' stroke='rgba(200,169,110,0.35)' strokeWidth='1.5' />
                  <circle cx='375' cy='136' r='5' fill='rgba(200,169,110,0.3)' />
                  <line x1='40' y1='162' x2='480' y2='162' stroke='rgba(200,169,110,0.1)' strokeWidth='1' />
                  <rect x='64' y='106' width='10' height='16' rx='1' fill='rgba(220,60,40,0.5)' />
                </svg>
              </div>
              <div style={{ position: 'absolute', top: '30%', right: '14%' }}>
                {['Open', 'Color', 'Light'].map((t, i) => (
                  <div key={t} className='rbtn' style={{ position: 'absolute', top: `${-40 + i * 34}px`, left: `${10 + (i === 1 ? 32 : 0)}px`, animationDelay: `${i * 0.3}s` }}>{t}</div>
                ))}
              </div>
            </div>
          </div>
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
              <div className='step-num'>{s.num}</div>
              <div className='step-icon'>{s.icon}</div>
              <div className='step-label'>{s.label}</div>
              <div className='step-t'>{s.title}</div>
              <div className='step-b'>{s.body}</div>
              <div className='step-time'>⟳ {s.time}</div>
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
              <span className='feat-icon'>{f.icon}</span>
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
          <Link href='/editor' className='btn-p'>Open Editor <span className='arrow'>→</span></Link>
          <a href='#how' className='btn-g'>Book a live demo</a>
        </div>
        <div className='lcta-trust'>
          {['Works in any browser', 'No SDK or app install', 'Publish in under 10 minutes'].map(t => (
            <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--c-gold)', opacity: 0.6 }}>✓</span> {t}
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
