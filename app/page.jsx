'use client'

import Link from 'next/link'
import {
  ArrowRight,
  Boxes,
  BrainCircuit,
  Camera,
  Check,
  DoorOpen,
  Gauge,
  Lightbulb,
  Monitor,
  Palette,
  ShieldCheck,
  Smartphone,
  Store,
  Upload,
  Wand2,
} from 'lucide-react'

const AUDIENCES = [
  ['Automotive brands', 'Launch a model configurator in one day', 'Upload a GLB, configure interactions, publish an iframe. No custom Three.js sprint.'],
  ['3D artists / riggers', 'Name it right. Everything else is automatic.', 'Follow the mesh naming guide. AutoZ detects parts, pivots, animations, and UI controls.'],
  ['Product teams', 'Update cameras and colors without engineers', 'Change camera presets, lighting, materials, shadows, and mobile previews in the editor.'],
  ['Platform teams', 'One iframe. Every car. No maintenance.', 'Immutable publish URLs keep old embeds stable while new snapshots can ship safely.'],
  ['Dealerships', 'Interactive inventory, live on your site', 'Doors open, lights turn on, wheels spin, camera angles work on desktop and mobile.'],
  ['Investors', 'A repeatable SaaS pipeline', 'Per-model publishing replaces bespoke viewer builds with a scalable production workflow.'],
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
  return (
    <main className='landing-root landing-v2'>
      <nav className='landing-nav'>
        <Link href='/' className='landing-brand'>
          <span />
          AutoZ Engine
        </Link>
        <div className='landing-nav-links'>
          <a href='#workflow'>Workflow</a>
          <a href='#pricing'>Pricing</a>
          <Link href='/taxonomy/docs/vehicles'>Artist guide</Link>
          <Link href='/editor'>Open Editor</Link>
        </div>
      </nav>

      <section className='landing-hero-v2'>
        <iframe
          src='https://auto-z-omega.vercel.app/frame/az-20aa774ed5'
          title='AutoZ live car viewer'
          allow='accelerometer; ambient-light-sensor; encrypted-media; gyroscope; xr-spatial-tracking'
          allowFullScreen
        />
        <div className='landing-hero-copy'>
          <div className='landing-kicker'>Config-driven 3D automotive SaaS</div>
          <h1>Publish premium car viewers without custom Three.js work.</h1>
          <p>
            AutoZ turns raw GLB car models into interactive, embeddable product experiences with part detection,
            smooth animations, camera presets, material controls, and mobile-ready iframe publishing.
          </p>
          <div className='landing-actions'>
            <Link href='/editor' className='landing-primary'>Open Editor <ArrowRight size={16} /></Link>
            <a href='#pricing' className='landing-secondary'>View pricing</a>
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

      <section className='landing-section'>
        <div className='landing-section-head'>
          <span>Who it is for</span>
          <h2>Built for the whole team, not just the 3D engineer.</h2>
        </div>
        <div className='landing-audience-grid'>
          {AUDIENCES.map(([label, title, body]) => (
            <article key={label} className='landing-card'>
              <span>{label}</span>
              <h3>{title}</h3>
              <p>{body}</p>
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

      <section className='landing-section'>
        <div className='landing-section-head'>
          <span>The time cost breakdown</span>
          <h2>From 10 weeks to 10 minutes.</h2>
        </div>
        <div className='landing-table'>
          <div className='landing-table-row landing-table-head'>
            <span>Task</span><span>Before</span><span>AutoZ</span>
          </div>
          {TIME_ROWS.map(([task, before, autoz]) => (
            <div key={task} className='landing-table-row'>
              <span>{task}</span><span>{before}</span><span>{autoz}</span>
            </div>
          ))}
          <div className='landing-saving'>
            <span>Typical cost saving per vehicle</span>
            <strong>$35,000 - $55,000</strong>
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
