'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Boxes,
  BrainCircuit,
  Camera,
  Check,
  Clock,
  DoorOpen,
  Gauge,
  Lightbulb,
  Monitor,
  Palette,
  Play,
  Rocket,
  ShieldCheck,
  Smartphone,
  Store,
  Upload,
  Wand2,
  Zap,
} from 'lucide-react'

const TEAM_FLOW = [
  { num: '01', icon: Boxes, role: '3D artist', action: 'Names the meshes', outcome: 'Clean GLB, hinges marked' },
  { num: '02', icon: Palette, role: 'Brand studio', action: 'Tunes paint & cameras', outcome: 'Locked-in showroom look' },
  { num: '03', icon: Rocket, role: 'Product team', action: 'Clicks Publish', outcome: 'Frozen iframe URL goes live' },
  { num: '04', icon: Store, role: 'Web team', action: 'Pastes one iframe', outcome: 'Live on dealer pages in 1 line' },
  { num: '05', icon: Smartphone, role: 'Buyer', action: 'Opens doors on mobile', outcome: 'Converts to test-drive' },
  { num: '06', icon: Gauge, role: 'Investor', action: 'Sees the pipeline', outcome: 'Per-model unit economics' },
]

const TIME_ROWS = [
  ['Model normalization', '2-3 days', '<60 sec'],
  ['Part detection + interaction wiring', '1-2 weeks', 'instant'],
  ['Door / bonnet animation setup', '3-5 days', '<10 min'],
  ['Body color + material variants', '2-4 days', '<5 min'],
  ['Lighting + HDRI environment', '1-3 days', '<5 min'],
  ['Camera + controls configuration', '2-3 days', '<5 min'],
  ['iframe embed + publish', '1-2 days', '<10 sec'],
  ['Update existing model', '1-2 weeks', '<60 sec'],
]

const FEATURES = [
  [Upload, 'Upload pipeline', 'GLB/GLTF import, resources, chunked uploads, and immutable publish snapshots.'],
  [Boxes, 'Part intelligence', 'Taxonomy-based detection for doors, lights, wheels, body paint, glass, mirrors, and more.'],
  [DoorOpen, 'Animation math', 'Hinge, spin, tint, light, and material transitions use stable delta damping.'],
  [Camera, 'Camera studio', 'Desktop/mobile preview, preset editing, cockpit yaw, pan control, and publish-safe frame modes.'],
  [Palette, 'Material controls', 'Body color, glass, chrome, rubber, reflection tuning, HDRI lighting, and post FX.'],
  [ShieldCheck, 'Embeddable runtime', 'Locked panning in production frames, stable URLs, and device-aware rendering defaults.'],
]

const HERO_METRICS = [
  ['10 min', 'from GLB to live iframe'],
  ['$35k+', 'saved per custom viewer'],
  ['0 code', 'for updates after launch'],
]

const PRICING = [
  {
    name: 'Starter',
    price: '$99',
    sub: '+ $149 per published model',
    body: 'For freelancers, small studios, and single-brand pilots.',
    items: ['Up to 3 active models', 'All part types + interactions', 'Immutable iframe publish', 'Community support'],
    cta: 'Get started free',
  },
  {
    name: 'Studio',
    price: '$499',
    sub: '+ $99 per published model',
    body: 'For brands and dealerships running multi-model catalogs.',
    items: ['Up to 20 active models', 'White-label iframe embed', 'Priority model processing', 'Analytics dashboard'],
    cta: 'Start free trial',
    popular: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    sub: 'Volume pricing',
    body: 'For OEMs, platform integrators, and fleets with SLA requirements.',
    items: ['Unlimited active models', 'Custom per-model pricing', 'White-label + domain', 'Dedicated SLA + onboarding'],
    cta: 'Book a demo',
  },
]

export default function LandingPage() {
  const [demoReady, setDemoReady] = useState(false)

  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'autoz:ready') setDemoReady(true)
    }
    window.addEventListener('message', handler)
    // Safety net: if the iframe never posts (older slug, blocked, etc.), reveal
    // after the max realistic warm-up window so the overlay never sticks.
    const fallback = window.setTimeout(() => setDemoReady(true), 12000)
    return () => {
      window.removeEventListener('message', handler)
      window.clearTimeout(fallback)
    }
  }, [])

  return (
    <main className='landing-root landing-v2'>
      <nav className='landing-nav'>
        <Link href='/' className='landing-brand'>
          <span className='landing-brand-mark' />
          <span className='landing-brand-copy'>
            <strong>AutoZ</strong>
            <small>Engine</small>
          </span>
        </Link>
        <input
          id='landing-nav-toggle'
          className='landing-nav-toggle'
          type='checkbox'
          aria-label='Toggle navigation menu'
        />
        <label htmlFor='landing-nav-toggle' className='landing-nav-burger' aria-hidden='true'>
          <span className='landing-nav-burger-bars'><i /><i /><i /></span>
        </label>
        <label htmlFor='landing-nav-toggle' className='landing-nav-backdrop' aria-hidden='true' />
        <div className='landing-nav-links'>
          <a href='#workflow'><Wand2 size={14} /> Workflow</a>
          <a href='#pricing'><Gauge size={14} /> Pricing</a>
          <Link href='/taxonomy/docs/vehicles'><Boxes size={14} /> Artist guide</Link>
        </div>
        <div className='landing-nav-actions'>
          <Link href='/editor'>Open Studio <ArrowRight size={14} /></Link>
        </div>
      </nav>

      <section className='landing-hero-v2'>
        <div className='landing-hero-copy'>
          <h1>Turn any 3D car model into a sellable web experience.</h1>
          <p>
            AutoZ gives brands, studios, and dealerships a premium 3D configurator pipeline:
            upload a GLB, auto-detect parts, tune materials and cameras, then publish a stable iframe
            your sales team can embed anywhere.
          </p>
          <div className='landing-actions'>
            <Link href='/editor' className='landing-primary'>Launch Studio <Rocket size={16} /></Link>
            <a href='#pricing' className='landing-secondary'><Play size={15} /> See the offer</a>
          </div>
          <div className='landing-hero-proof' aria-label='AutoZ business metrics'>
            {HERO_METRICS.map(([value, label]) => (
              <div key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className='landing-trust' aria-label='Customer trust'>
            <div className='landing-trust-avatars' aria-hidden='true'>
              {['AZ', 'EV', '3D', 'GT', 'XR'].map((label) => <span key={label}>{label}</span>)}
            </div>
            <div className='landing-trust-copy'>
              <div className='landing-trust-stars' aria-label='5 out of 5 stars'>
                {[0, 1, 2, 3, 4].map((i) => <span key={i}>★</span>)}
              </div>
              <p>
                <strong>10+ automobile brands</strong>
                <span> shipping interactive viewers with AutoZ.</span>
              </p>
            </div>
          </div>
        </div>
        <div className='demo-stage'>
          <div className='demo-signals' aria-label='Live runtime signals'>
            <div className='demo-signal'>
              <span className='demo-signal-pulse' aria-hidden='true'><span /></span>
              <Boxes size={14} />
              <div className='demo-signal-body'>
                <strong>Auto-detected</strong>
                <span>Doors · Lights · Wheels · Paint</span>
              </div>
            </div>
            <div className='demo-signal'>
              <span className='demo-signal-pulse' aria-hidden='true'><span /></span>
              <Smartphone size={14} />
              <div className='demo-signal-body'>
                <strong>Buyer mode</strong>
                <span>Mobile-safe controls</span>
              </div>
            </div>
            <div className='demo-signal'>
              <span className='demo-signal-pulse' aria-hidden='true'><span /></span>
              <ShieldCheck size={14} />
              <div className='demo-signal-body'>
                <strong>Published-ready</strong>
                <span>Stable iframe URL</span>
              </div>
            </div>
          </div>
          <div className={`demo-frame-wrap ${demoReady ? 'is-ready' : ''}`} aria-label='Interactive 3D car demo'>
            <iframe
              src='/frame/demo'
              title='AutoZ live car viewer'
              allow='accelerometer; ambient-light-sensor; encrypted-media; gyroscope; xr-spatial-tracking'
              allowFullScreen
            />
            <div className='demo-frame-overlay' aria-hidden={demoReady}>
              <div className='demo-frame-sheen' />
              <div className='demo-frame-glow' />
              <div className='demo-frame-spinner' />
            </div>
          </div>
        </div>
      </section>

      <section className='landing-band'>
        {[
          ['<10 min', 'model setup'],
          ['60 fps', 'desktop target'],
          ['100%', 'snapshot reproducibility'],
          ['0 code', 'for marketing updates'],
        ].map(([value, label]) => (
          <div key={label} className='landing-metric'>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>

      <section className='landing-section landing-team'>
        <div className='landing-section-head landing-section-head--centered'>
          <span>How the team plays</span>
          <h2>One canvas. <em>Six handoffs.</em> Zero waiting.</h2>
          <p className='landing-section-lead'>Built for the whole team, not just the 3D engineer — every role gets a clean handoff with their own slice of the editor.</p>
        </div>
        <div className='team-track'>
          {TEAM_FLOW.map((step, i) => (
            <article key={step.num} className='team-step' style={{ '--i': i }}>
              <div className='team-step-num'>{step.num}</div>
              <div className='team-step-icon'><step.icon size={20} strokeWidth={2.2} /></div>
              <span className='team-step-role'>{step.role}</span>
              <h3>{step.action}</h3>
              <div className='team-step-out'>
                <ArrowRight size={11} aria-hidden='true' />
                <span>{step.outcome}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className='landing-section landing-split' id='workflow'>
        <div>
          <span className='landing-kicker'>Workflow</span>
          <h2>From upload to production iframe.</h2>
          <p>Normalize the model, approve detected parts, tune camera presets, test desktop/mobile preview, and publish a frozen runtime URL.</p>
        </div>
        <div className='landing-mini-chain'>
          <div className='landing-mini-stack'>
            <div><Upload size={17} /> GLB / GLTF</div>
            <div><Wand2 size={17} /> Mesh names</div>
            <div><Gauge size={17} /> Origins</div>
          </div>
          <div className='taxonomy-connector' />
          <div className='taxonomy-engine-card landing-engine-card'>
            <BrainCircuit size={28} />
            <div className='taxonomy-engine-badge'>Advanced animation engine</div>
            <h3>AutoZ Predictor</h3>
            <p>Detects parts, pivots, cameras, materials, and publish-ready interactions.</p>
            <div className='taxonomy-scanline' />
          </div>
          <div className='taxonomy-connector' />
          <div className='landing-mini-stack'>
            <div><Monitor size={17} /> Desktop iframe</div>
            <div><Smartphone size={17} /> Mobile viewer</div>
            <div><Store size={17} /> Shopify + stores</div>
          </div>
        </div>
      </section>

      <section className='landing-section landing-section--time'>
        <div className='landing-section-head landing-section-head--centered'>
          <span>The time cost breakdown</span>
          <h2>From <em>10 weeks</em> to <em>10 minutes</em>.</h2>
          <p className='landing-section-lead'>Every step of the bespoke 3D viewer pipeline, collapsed into the AutoZ editor.</p>
        </div>
        <div className='landing-table'>
          <div className='landing-table-row landing-table-head'>
            <span>Task</span>
            <span><Clock size={12} /> Custom build</span>
            <span><Zap size={12} /> AutoZ</span>
          </div>
          {TIME_ROWS.map(([task, before, autoz]) => (
            <div key={task} className='landing-table-row'>
              <span className='landing-table-task'>{task}</span>
              <span className='landing-table-before'>{before}</span>
              <span className='landing-table-after'>{autoz}</span>
            </div>
          ))}
        </div>
        <div className='landing-saving'>
          <div className='landing-saving-copy'>
            <span>Typical cost saving per vehicle</span>
            <strong>$35,000 — $55,000</strong>
          </div>
          <div className='landing-saving-meta'>
            <Zap size={14} /> Across detection, animation, materials, cameras, and publish.
          </div>
        </div>
      </section>

      <section className='landing-section'>
        <div className='landing-section-head'>
          <span>Feature stack</span>
          <h2>One editor for the whole viewer.</h2>
        </div>
        <div className='landing-feature-grid'>
          {FEATURES.map(([Icon, title, body]) => (
            <article key={title}>
              <Icon size={21} />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className='landing-section' id='pricing'>
        <div className='landing-section-head'>
          <span>Pricing</span>
          <h2>Pay per model. Scale without limits.</h2>
        </div>
        <div className='landing-pricing-grid'>
          {PRICING.map((plan) => (
            <article key={plan.name} className={plan.popular ? 'landing-price-card landing-price-card--hot' : 'landing-price-card'}>
              {plan.popular && <div className='landing-popular'>Most popular</div>}
              <h3>{plan.name}</h3>
              <div className='landing-price'>{plan.price}<span>{plan.price !== 'Custom' ? '/mo' : ''}</span></div>
              <p className='landing-price-sub'>{plan.sub}</p>
              <p>{plan.body}</p>
              <ul>
                {plan.items.map((item) => <li key={item}><Check size={14} /> {item}</li>)}
              </ul>
              <Link href='/editor' className={plan.popular ? 'landing-primary' : 'landing-secondary'}>{plan.cta}</Link>
            </article>
          ))}
        </div>
      </section>

      <section className='landing-section landing-guide' id='guide'>
        <div>
          <span className='landing-kicker'>Artist guide</span>
          <h2>Blender naming rules that make detection reliable.</h2>
          <p>Name meshes with clear part tokens and place origins at hinge or axle points. AutoZ handles duplicate suffixes, common aliases, and fuzzy fallback, but exact names give the strongest result.</p>
        </div>
        <div className='landing-guide-list'>
          {[
            ['Door_FL', 'front left door, hinge origin'],
            ['wheel_fr', 'front right wheel, axle center'],
            ['headlight_l', 'left headlight toggle'],
            ['bonnet', 'hood hinge near windshield'],
          ].map(([name, desc]) => (
            <div key={name}><code>{name}</code><span>{desc}</span></div>
          ))}
        </div>
      </section>

      <section className='landing-final'>
        <Lightbulb size={24} />
        <h2>Bring the next car model. AutoZ will wire the viewer.</h2>
        <Link href='/editor' className='landing-primary'>Launch Studio <ArrowRight size={16} /></Link>
      </section>

      <footer className='landing-footer'>
        <span>AutoZ Engine</span>
        <span>Config-driven 3D automotive publishing</span>
      </footer>
    </main>
  )
}
