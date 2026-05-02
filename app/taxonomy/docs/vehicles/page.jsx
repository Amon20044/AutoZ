'use client'

import Link from 'next/link'
import {
  ArrowRight,
  Bike,
  BrainCircuit,
  Bus,
  Car,
  Check,
  Code2,
  DoorOpen,
  FileText,
  Gauge,
  Lightbulb,
  Monitor,
  ScanSearch,
  ShoppingBag,
  Smartphone,
  Store,
  Truck,
  Upload,
  Wand2,
} from 'lucide-react'

const VEHICLES = [
  [Car, 'Cars', 'doors, bonnet, trunk, lights, wheels, mirrors, paint'],
  [Bike, 'Bikes', 'wheels, body panels, lights, mirrors, seats, forks'],
  [Truck, 'Trucks', 'cab doors, cargo body, lamps, wheels, grille, mirrors'],
  [Bus, 'Buses', 'doors, panels, lights, wheels, glass, interior sections'],
]

const NAMING_ROWS = [
  ['Body / paint', 'body', 'shell, chassis, paint, exterior'],
  ['Front left door', 'Door_FL', 'door_front_left, driver_door, fl_door'],
  ['Front right door', 'Door_FR', 'door_front_right, passenger_door, fr_door'],
  ['Hood / bonnet', 'bonnet', 'hood, engine_cover, front_hood'],
  ['Trunk / tailgate', 'trunk', 'tailgate, boot, liftgate, rear_lid'],
  ['Wheel front left', 'wheel_fl', 'tire_fl, tyre_fl'],
  ['Left headlight', 'headlight_l', 'headlight_left, hl_left'],
  ['Left mirror', 'mirror_l', 'mirror_left, side_mirror_l'],
]

const PARTS = [
  ['body', 'Body Shell', 'color_change'],
  ['door.front.left', 'Front Left Door', 'hinge_open_close'],
  ['door.front.right', 'Front Right Door', 'hinge_open_close'],
  ['bonnet.front', 'Bonnet / Hood', 'hinge_open_close'],
  ['bonnet.rear', 'Trunk / Tailgate', 'hinge_open_close'],
  ['light.head.front.left', 'Left Headlight', 'toggle'],
  ['wheel.front.left', 'Front Left Wheel', 'spin'],
  ['mirror.left', 'Left Mirror', 'fold'],
  ['glass.windshield', 'Windshield', 'tint'],
  ['roof.sunroof', 'Sunroof', 'slide'],
  ['cap.fuel', 'Fuel Cap', 'hinge_open_close'],
  ['spoiler', 'Spoiler', 'extend'],
]

const ORIGINS = [
  ['Doors', 'Origin at hinge edge, not the panel center.'],
  ['Bonnet', 'Origin at rear hinge line near windshield base.'],
  ['Trunk', 'Origin at top hinge line near rear roof edge.'],
  ['Wheels', 'Origin at axle center for stable spin.'],
  ['Mirrors', 'Origin at mirror arm base where it folds.'],
  ['Static parts', 'Origin to geometry is fine for lights, glass, grille, bumpers.'],
]

const OUTPUTS = [
  [Monitor, 'Desktop viewer', 'Full-size showroom iframe'],
  [Smartphone, 'Mobile optimized', 'Touch-safe controls and camera presets'],
  [ShoppingBag, 'Shopify', 'Drop the iframe into product pages'],
  [Store, 'Ecommerce stores', 'Works with WooCommerce, Webflow, custom CMS'],
  [Code2, 'Any website', 'Embed code with a frozen publish URL'],
]

export default function VehicleTaxonomyPage() {
  return (
    <main className='taxonomy-page'>
      <nav className='taxonomy-nav'>
        <Link href='/' className='taxonomy-brand'><span /> AutoZ Engine</Link>
        <div>
          <Link href='/editor'>Open Editor</Link>
          <Link href='/'>Back to site</Link>
        </div>
      </nav>

      <section className='taxonomy-hero'>
        <div>
          <div className='taxonomy-kicker'>Vehicle taxonomy docs</div>
          <h1>Name vehicle parts logically. AutoZ Predictor wires the viewer.</h1>
          <p>
            Build cars, bikes, trucks, buses, and custom vehicles with the same rule: mesh names should logically
            match the part. Case does not matter. Separators do not matter. AutoZ normalizes names, scores matches,
            predicts part type, and turns your model into a desktop and mobile ready product viewer.
          </p>
          <div className='taxonomy-actions'>
            <a href='#naming' className='landing-primary'>Naming cheatsheet <ArrowRight size={16} /></a>
            <a href='#origins' className='landing-secondary'>Origin rules</a>
          </div>
        </div>
        <div className='taxonomy-vehicle-grid'>
          {VEHICLES.map(([Icon, title, body]) => (
            <article key={title}>
              <Icon size={22} />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className='taxonomy-chain-section'>
        <div className='taxonomy-section-head'>
          <span>Input engine to output runtime</span>
          <h2>One naming convention becomes every storefront experience.</h2>
        </div>
        <div className='taxonomy-chain'>
          <div className='taxonomy-chain-stack'>
            <h3>Input</h3>
            {[
              [Upload, 'GLB / GLTF model'],
              [FileText, 'Mesh names'],
              [Gauge, 'Origins and pivots'],
            ].map(([Icon, label]) => (
              <div key={label} className='taxonomy-chain-pill'><Icon size={18} /> {label}</div>
            ))}
          </div>

          <div className='taxonomy-connector' />

          <div className='taxonomy-engine-card'>
            <BrainCircuit size={30} />
            <h3>AutoZ Predictor</h3>
            <p>Exact tokens, regex patterns, fuzzy matching, weights, and confidence thresholds.</p>
            <div className='taxonomy-scanline' />
          </div>

          <div className='taxonomy-connector' />

          <div className='taxonomy-output-grid'>
            <h3>Output</h3>
            {OUTPUTS.map(([Icon, title, body]) => (
              <div key={title} className='taxonomy-output-pill'>
                <Icon size={18} />
                <div><strong>{title}</strong><span>{body}</span></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className='taxonomy-section'>
        <div className='taxonomy-note'>
          <ScanSearch size={22} />
          <div>
            <h2>How matching works</h2>
            <p>
              The predictor strips duplicate suffixes like <code>.001</code>, splits camelCase, converts separators
              to underscores, lowercases everything, then scores the result. <code>Door_FL</code>, <code>door-fl</code>,
              <code>door fl</code>, and <code>DOOR.FL.001</code> can all resolve to the same logical part.
            </p>
          </div>
        </div>
        <div className='taxonomy-stage-grid'>
          {[
            ['1', 'Exact token match', 'Highest confidence. Use names like wheel_fl, Door_FR, headlight_l.'],
            ['2', 'Regex pattern match', 'Accepts common formatting and ordering variations.'],
            ['3', 'Fuzzy fallback', 'Handles near misses, but production models should aim for exact names.'],
          ].map(([num, title, body]) => (
            <article key={num}>
              <strong>{num}</strong>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className='taxonomy-section' id='naming'>
        <div className='taxonomy-section-head'>
          <span>Recommended names</span>
          <h2>Use clean part names. The engine handles case and separators.</h2>
        </div>
        <div className='taxonomy-table'>
          <div className='taxonomy-table-row taxonomy-table-head'>
            <span>Part</span><span>Best name</span><span>Also accepted</span>
          </div>
          {NAMING_ROWS.map(([part, best, accepted]) => (
            <div className='taxonomy-table-row' key={part}>
              <span>{part}</span><code>{best}</code><span>{accepted}</span>
            </div>
          ))}
        </div>
      </section>

      <section className='taxonomy-section'>
        <div className='taxonomy-section-head'>
          <span>Canonical type keys</span>
          <h2>What AutoZ turns detected parts into.</h2>
        </div>
        <div className='taxonomy-part-grid'>
          {PARTS.map(([key, label, action]) => (
            <article key={key}>
              <code>{key}</code>
              <h3>{label}</h3>
              <span>{action}</span>
            </article>
          ))}
        </div>
      </section>

      <section className='taxonomy-section taxonomy-origin-section' id='origins'>
        <div>
          <div className='taxonomy-kicker'>Pivot rules</div>
          <h2>Names identify the part. Origins make animation correct.</h2>
          <p>
            Hinged parts need their origin at the hinge or pivot point. Wheels need axle-center origins. Static
            material parts can use origin-to-geometry. This is the difference between a clean production viewer
            and a part that swings from the wrong place.
          </p>
        </div>
        <div className='taxonomy-origin-list'>
          {ORIGINS.map(([title, body]) => (
            <div key={title}><Check size={16} /><strong>{title}</strong><span>{body}</span></div>
          ))}
        </div>
      </section>

      <section className='taxonomy-final'>
        <DoorOpen size={24} />
        <h2>Rename meshes, set origins, upload, and publish anywhere.</h2>
        <p>AutoZ creates a desktop and mobile optimized iframe you can use on Shopify, ecommerce stores, dealer sites, product pages, and custom apps.</p>
        <Link href='/editor' className='landing-primary'>Open AutoZ Editor <ArrowRight size={16} /></Link>
      </section>

      <footer className='taxonomy-footer'>
        <span>AutoZ Vehicle Taxonomy</span>
        <span>Logical names in. Production viewers out.</span>
      </footer>
    </main>
  )
}
