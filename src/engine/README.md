# 🚗 AutoZ Engine

> Config-driven 3D automotive visualization engine with intelligent part detection, automated animations, and a studio-grade viewport.

---

## Architecture

```
src/engine/
├── math/                           ← Framework-agnostic math utilities
│   ├── normalization.js            ← Unit conversion, AABB, scale-fit, ground alignment, Rodrigues rotation
│   ├── animation.js                ← Exponential damping, SmoothValue/SmoothColor, blink formulas
│   ├── camera.js                   ← Auto-fit distance, bounding sphere, focus-on-part, LOD
│   ├── radial.js                   ← Radial button positions, constant scale, world→screen projection
│   ├── quality.js                  ← Adaptive DPR controller, quality presets (low/medium/high)
│   └── index.js                    ← Barrel export
│
├── core/                           ← Scene graph engine
│   ├── mesh-traversal.js           ← Walk scene graph, build mesh index, compute bounds, stats
│   ├── part-taxonomy.js            ← 30+ part definitions with detection rules (see below)
│   ├── part-detector.js            ← Hybrid fuzzy+regex scorer with Levenshtein, Jaccard, n-gram
│   ├── part-registry.js            ← PartEntry factory, PartRegistry (lookup by id/type/category)
│   ├── part-builder.js             ← Orchestrator: auto-detect + manual config → PartRegistry
│   ├── material-engine.js          ← Preset materials (car paint, glass, chrome), variant switcher
│   ├── interaction-engine.js       ← Per-frame state machine: hinge/toggle/blink/color/spin/tint
│   ├── scene-assembler.js          ← AutoZEngine class (top-level orchestrator)
│   └── index.js                    ← Barrel export
│
├── pipeline/                       ← Import & processing
│   ├── import-pipeline.js          ← GLB/GLTF parse → normalize → detect → ready (with live events)
│   └── processing-bus.js           ← EventEmitter for streaming step progress
│
├── hooks/
│   └── useAutoZEngine.js           ← React Three Fiber hook binding
│
└── index.js                        ← Root barrel: import { AutoZEngine } from '@/engine'
```

---

## Part Detection System

### How It Works

When a 3D model is loaded, every mesh in the scene graph is indexed by name. Each mesh name is then scored against **30+ part definitions** using a **3-stage hybrid classifier**:

```
Mesh Name: "Door_Front_Left.001"
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
 EXACT TOKEN     REGEX PATTERN    FUZZY MATCH
 Score: 0.95     Score: 0.80      Score: 0..0.70
    │               │               │
    └───────┬───────┘               │
            ▼                       ▼
      max(exact, regex, fuzzy) × weight
                    │
                    ▼
            Final Score (0..1)
                    │
              ≥ threshold (0.45)?
                    │
              ┌─────┴─────┐
              YES         NO
           Detected    Unmatched
```

**Stage 1 — Exact Token Match** (confidence: 0.95)
Direct string comparison against known naming conventions from Blender, Maya, 3ds Max, and SketchFab exports.

**Stage 2 — Regex Pattern Match** (confidence: 0.80)
Compiled regex patterns that handle separators (`_`, `.`, `-`, camelCase) and language variants (English, German, French).

**Stage 3 — Fuzzy Match** (confidence: 0..0.70)
Combined Levenshtein distance + Jaccard token similarity + character bigram matching. Handles typos, abbreviations, and unconventional naming.

### Pre-Processing

Before matching, mesh names are **tokenized**:
- `DoorFrontLeft` → `['door', 'front', 'left']` (camelCase split)
- `door_FL.001` → `['door', 'fl']` (Blender suffix stripped)
- `Tür_Vorne_Links` → `['tuer', 'vorne', 'links']` (unicode normalized)

---

## Complete Part Taxonomy

### 🚪 Doors — `hinge_open_close`

| Part | typeKey | Exact Tokens | Regex Patterns | Fuzzy Tokens | Axis | Angle |
|------|---------|-------------|----------------|--------------|------|-------|
| Front Left Door | `door.front.left` | `door_fl`, `doorfl`, `door_front_left`, `frontleftdoor`, `driver_door`, `fl_door`, `door_lf`, `tuer_vl`, `porte_avg` | `door[_.]?f[_.]?l`, `front[_.]?left[_.]?door`, `driver[_.]?door` | door, front, left, driver, fl | Y `[0,1,0]` | **65°** outward-left |
| Front Right Door | `door.front.right` | `door_fr`, `doorfr`, `door_front_right`, `frontrightdoor`, `passenger_door`, `fr_door`, `door_rf`, `tuer_vr`, `porte_avd` | `door[_.]?f[_.]?r`, `front[_.]?right[_.]?door`, `passenger[_.]?door` | door, front, right, passenger, fr | -Y `[0,-1,0]` | **65°** outward-right |
| Rear Left Door | `door.rear.left` | `door_rl`, `doorrl`, `door_rear_left`, `rearleftdoor`, `rl_door`, `door_lr`, `tuer_hl`, `porte_arg` | `door[_.]?r[_.]?l`, `rear[_.]?left[_.]?door` | door, rear, left, rl, back | Y `[0,1,0]` | **65°** outward-left |
| Rear Right Door | `door.rear.right` | `door_rr`, `doorrr`, `door_rear_right`, `rearrightdoor`, `rr_door`, `tuer_hr`, `porte_ard` | `door[_.]?r[_.]?r`, `rear[_.]?right[_.]?door` | door, rear, right, rr, back | -Y `[0,-1,0]` | **65°** outward-right |

### 🔧 Bonnet / Hood — `hinge_open_close`

| Part | typeKey | Exact Tokens | Regex Patterns | Fuzzy Tokens | Axis | Angle |
|------|---------|-------------|----------------|--------------|------|-------|
| Bonnet / Hood | `bonnet.front` | `bonnet`, `hood`, `motorhaube`, `capot`, `engine_cover`, `front_hood`, `front_bonnet` | `bonnet`, `hood`, `motorhaube`, `capot`, `engine[_.]?cover` | bonnet, hood, engine, cover, capot | X `[1,0,0]` | **-65°** tilts up from front |

### 📦 Trunk / Tailgate — `hinge_open_close`

| Part | typeKey | Exact Tokens | Regex Patterns | Fuzzy Tokens | Axis | Angle |
|------|---------|-------------|----------------|--------------|------|-------|
| Trunk / Tailgate | `bonnet.rear` | `trunk`, `tailgate`, `boot`, `hatch`, `kofferraum`, `coffre`, `rear_lid`, `trunk_lid`, `decklid`, `liftgate` | `trunk`, `tailgate`, `boot`, `hatch`, `kofferraum`, `coffre`, `decklid`, `liftgate` | trunk, tailgate, boot, hatch, rear, lid | X `[1,0,0]` | **60°** lifts up from rear |

### 🪞 Mirrors — `fold`

| Part | typeKey | Exact Tokens | Regex Patterns | Fuzzy Tokens | Axis | Angle |
|------|---------|-------------|----------------|--------------|------|-------|
| Left Mirror | `mirror.left` | `mirror_l`, `mirror_left`, `side_mirror_l`, `wing_mirror_l`, `spiegel_l`, `retroviseur_g` | `mirror[_.]?l`, `left[_.]?(side[_.]?)?mirror`, `wing[_.]?mirror[_.]?l` | mirror, side, wing, left | Y `[0,1,0]` | **-80°** folds inward |
| Right Mirror | `mirror.right` | `mirror_r`, `mirror_right`, `side_mirror_r`, `wing_mirror_r`, `spiegel_r`, `retroviseur_d` | `mirror[_.]?r`, `right[_.]?(side[_.]?)?mirror`, `wing[_.]?mirror[_.]?r` | mirror, side, wing, right | -Y `[0,-1,0]` | **80°** folds inward |

### 🏎️ Spoiler — `extend`

| Part | typeKey | Exact Tokens | Regex Patterns | Fuzzy Tokens | Axis | Angle |
|------|---------|-------------|----------------|--------------|------|-------|
| Spoiler | `spoiler` | `spoiler`, `rear_wing`, `wing`, `heckspoiler`, `becquet`, `rear_spoiler` | `spoiler`, `rear[_.]?wing`, `heckspoiler`, `becquet` | spoiler, wing, rear | X `[1,0,0]` | **25°** rises upward |

### ⛽ Caps — `hinge_open_close`

| Part | typeKey | Exact Tokens | Regex Patterns | Fuzzy Tokens | Axis | Angle |
|------|---------|-------------|----------------|--------------|------|-------|
| Fuel Cap | `cap.fuel` | `fuel_cap`, `gas_cap`, `filler_cap`, `fuel_door`, `gas_door`, `tankdeckel`, `trappe_essence` | `fuel[_.]?(cap\|door\|lid)`, `gas[_.]?(cap\|door\|lid)`, `filler`, `tankdeckel` | fuel, gas, cap, filler, tank | Y `[0,1,0]` | **90°** full swing |
| Charging Port | `cap.charge` | `charge_port`, `charging_port`, `ev_port`, `charge_cap`, `charge_door`, `ladeklappe` | `charg(e\|ing)[_.]?(port\|cap\|door\|lid)`, `ev[_.]?port`, `ladeklappe` | charge, charging, port, ev, electric | Y `[0,1,0]` | **90°** full swing |

### ☀️ Sunroof — `slide`

| Part | typeKey | Exact Tokens | Regex Patterns | Fuzzy Tokens | Axis | Angle |
|------|---------|-------------|----------------|--------------|------|-------|
| Sunroof | `roof.sunroof` | `sunroof`, `moonroof`, `panoramic_roof`, `schiebedach`, `toit_ouvrant` | `sun[_.]?roof`, `moon[_.]?roof`, `panoramic`, `schiebedach` | sunroof, moonroof, panoramic, roof, open | Z `[0,0,1]` | slides back |

### 💡 Headlights — `toggle` (emissive ON/OFF)

| Part | typeKey | Exact Tokens | Regex Patterns | Fuzzy Tokens |
|------|---------|-------------|----------------|--------------|
| Left Headlight | `light.head.front.left` | `headlight_l`, `headlight_left`, `hl_left`, `head_light_l`, `scheinwerfer_l`, `phare_g` | `head[_.]?light[_.]?l`, `l[_.]?head[_.]?light`, `hl[_.]?l`, `left[_.]?head`, `scheinwerfer.*l` | headlight, head, light, left, front |
| Right Headlight | `light.head.front.right` | `headlight_r`, `headlight_right`, `hl_right`, `head_light_r`, `scheinwerfer_r`, `phare_d` | `head[_.]?light[_.]?r`, `r[_.]?head[_.]?light`, `hl[_.]?r`, `right[_.]?head`, `scheinwerfer.*r` | headlight, head, light, right, front |

### 💡 Taillights — `toggle` (emissive ON/OFF)

| Part | typeKey | Exact Tokens | Regex Patterns | Fuzzy Tokens |
|------|---------|-------------|----------------|--------------|
| Left Taillight | `light.tail.rear.left` | `taillight_l`, `tail_light_left`, `tl_left`, `rearlight_l`, `ruecklicht_l`, `feu_arriere_g` | `tail[_.]?light[_.]?l`, `l[_.]?tail`, `rear[_.]?light[_.]?l`, `ruecklicht.*l`, `brake[_.]?l` | tail, light, left, rear, brake |
| Right Taillight | `light.tail.rear.right` | `taillight_r`, `tail_light_right`, `tl_right`, `rearlight_r`, `ruecklicht_r`, `feu_arriere_d` | `tail[_.]?light[_.]?r`, `r[_.]?tail`, `rear[_.]?light[_.]?r`, `ruecklicht.*r`, `brake[_.]?r` | tail, light, right, rear, brake |

### 💡 Indicators — `blink` (pulsing 1.5Hz)

| Part | typeKey | Exact Tokens | Regex Patterns | Fuzzy Tokens |
|------|---------|-------------|----------------|--------------|
| Front Left Indicator | `light.indicator.front.left` | `indicator_fl`, `turn_signal_fl`, `blinker_fl`, `blinker_vl` | `(indicator\|turn[_.]?signal\|blinker)[_.]?f[_.]?l` | indicator, turn, signal, blinker, front, left |
| Front Right Indicator | `light.indicator.front.right` | `indicator_fr`, `turn_signal_fr`, `blinker_fr`, `blinker_vr` | `(indicator\|turn[_.]?signal\|blinker)[_.]?f[_.]?r` | indicator, turn, signal, blinker, front, right |

### ⚙️ Wheels — `spin` (continuous rotation)

| Part | typeKey | Exact Tokens | Regex Patterns | Fuzzy Tokens | Axis |
|------|---------|-------------|----------------|--------------|------|
| Front Left Wheel | `wheel.front.left` | `wheel_fl`, `tire_fl`, `tyre_fl`, `rad_vl`, `roue_avg` | `wheel[_.]?f[_.]?l`, `f[_.]?l[_.]?wheel`, `tire[_.]?f[_.]?l`, `front[_.]?left[_.]?wheel` | wheel, tire, tyre, front, left | X `[1,0,0]` |
| Front Right Wheel | `wheel.front.right` | `wheel_fr`, `tire_fr`, `tyre_fr`, `rad_vr`, `roue_avd` | `wheel[_.]?f[_.]?r`, `f[_.]?r[_.]?wheel`, `tire[_.]?f[_.]?r`, `front[_.]?right[_.]?wheel` | wheel, tire, tyre, front, right | X `[1,0,0]` |
| Rear Left Wheel | `wheel.rear.left` | `wheel_rl`, `tire_rl`, `tyre_rl`, `rad_hl`, `roue_arg` | `wheel[_.]?r[_.]?l`, `r[_.]?l[_.]?wheel`, `tire[_.]?r[_.]?l`, `rear[_.]?left[_.]?wheel` | wheel, tire, tyre, rear, left | X `[1,0,0]` |
| Rear Right Wheel | `wheel.rear.right` | `wheel_rr`, `tire_rr`, `tyre_rr`, `rad_hr`, `roue_ard` | `wheel[_.]?r[_.]?r`, `r[_.]?r[_.]?wheel`, `tire[_.]?r[_.]?r`, `rear[_.]?right[_.]?wheel` | wheel, tire, tyre, rear, right | X `[1,0,0]` |

### 🔩 Rims — `color_change`

| Part | typeKey | Exact Tokens | Regex Patterns | Fuzzy Tokens |
|------|---------|-------------|----------------|--------------|
| Front Left Rim | `rim.front.left` | `rim_fl`, `hubcap_fl`, `felge_vl` | `rim[_.]?f[_.]?l`, `f[_.]?l[_.]?rim` | rim, hub, alloy, front, left |

### 🪟 Glass / Windows — `tint` (opacity change)

| Part | typeKey | Exact Tokens | Regex Patterns | Fuzzy Tokens |
|------|---------|-------------|----------------|--------------|
| Windshield | `glass.windshield` | `windshield`, `windscreen`, `frontglass`, `front_glass`, `windschutzscheibe`, `pare_brise` | `windshi?eld`, `windscreen`, `front[_.]?glass` | windshield, windscreen, front, glass |
| Rear Window | `glass.rear` | `rear_glass`, `rear_window`, `back_glass`, `heckscheibe`, `lunette_arriere` | `rear[_.]?(glass\|window)`, `back[_.]?(glass\|window)`, `heckscheibe` | rear, window, glass, back |
| Side Windows | `glass.side` | `side_glass`, `side_window`, `window_glass`, `seitenscheibe` | `side[_.]?(glass\|window)`, `window[_.]?glass`, `glass` | side, window, glass |

### 🎨 Body — `color_change`

| Part | typeKey | Exact Tokens | Regex Patterns | Fuzzy Tokens |
|------|---------|-------------|----------------|--------------|
| Body Shell | `body` | `body`, `shell`, `chassis`, `frame`, `exterior`, `paint`, `bodywork`, `karosserie`, `carrosserie`, `coque`, `bodyshell`, `carbody` | `bod(y\|ie)`, `shell`, `chassis`, `paint`, `exterior`, `kaross`, `coque` | body, shell, chassis, paint, exterior |

### 🛡️ Static Parts — `none` (detected, no animation)

| Part | typeKey | Exact Tokens | Regex Patterns | Fuzzy Tokens |
|------|---------|-------------|----------------|--------------|
| Front Bumper | `bumper.front` | `front_bumper`, `bumper_front`, `stossstange_vorne`, `pare_chocs_avant` | `front[_.]?bumper`, `bumper[_.]?front` | bumper, front |
| Rear Bumper | `bumper.rear` | `rear_bumper`, `bumper_rear`, `stossstange_hinten`, `pare_chocs_arriere` | `rear[_.]?bumper`, `bumper[_.]?rear` | bumper, rear, back |
| Grille | `grille` | `grille`, `grill`, `front_grille`, `kuehlergrill`, `calandre`, `radiator_grille` | `grill(e)?`, `kuehlergrill`, `calandre`, `radiator` | grille, grill, radiator, front |

---

## Multi-Language Support

The detection engine recognizes naming conventions in **3 languages**:

| Language | Examples |
|----------|---------|
| 🇬🇧 English | `door`, `hood`, `trunk`, `headlight`, `mirror`, `wheel`, `windshield` |
| 🇩🇪 German | `tuer` (Tür), `motorhaube`, `kofferraum`, `scheinwerfer`, `spiegel`, `rad`, `windschutzscheibe`, `felge`, `stossstange`, `seitenscheibe`, `heckscheibe`, `schiebedach`, `tankdeckel`, `ladeklappe`, `ruecklicht`, `kuehlergrill`, `heckspoiler`, `karosserie` |
| 🇫🇷 French | `porte` (door), `capot` (hood), `coffre` (trunk), `phare` (headlight), `retroviseur` (mirror), `roue` (wheel), `pare_brise` (windshield), `calandre` (grille), `becquet` (spoiler), `feu_arriere` (taillight), `carrosserie` (body), `toit_ouvrant` (sunroof), `trappe_essence` (fuel cap), `pare_chocs` (bumper), `lunette_arriere` (rear window) |

---

## Animation Types

| Type | Mechanism | Formula | Used By |
|------|-----------|---------|---------|
| `hinge_open_close` | Pivot rotation with exponential damping | `θ(t+dt) = θ + (θ_target − θ)(1 − e^(−λΔt))` | Doors, bonnet, trunk, caps |
| `fold` | Same as hinge (mirror-specific defaults) | Same | Mirrors |
| `extend` | Same as hinge (spoiler-specific defaults) | Same | Spoiler |
| `slide` | Translation along axis | Linear interpolation | Sunroof |
| `toggle` | Emissive intensity lerp | `I(t) → target via exp damp` | Headlights, taillights |
| `blink` | Hard or smooth blink | `I(t) = Imax · step(0.5, sin(2πft))` | Indicators |
| `color_change` | RGB color lerp | `C(t) → target via exp damp per channel` | Body paint, rims |
| `spin` | Continuous rotation | `θ += speed × dt` | Wheels |
| `tint` | Opacity change | `opacity → target via exp damp` | Glass, windows |

---

## Supported Formats

| Format | Status | Notes |
|--------|--------|-------|
| `.glb` | ✅ Full support | Self-contained binary — **recommended** |
| `.gltf` + folder | ✅ Full support | Drop the entire extracted folder (`.gltf` + `.bin` + `textures/`) |
| `.gltf` standalone | ✅ Full support | Embedded buffers/textures (data URIs) |
| Draco compressed | ✅ Full support | Auto-detected, decoded via Google CDN |
| Meshopt compressed | ✅ Full support | Auto-detected |

---

## Quick Start

```jsx
import { AutoZEngine } from '@/engine'

// In a React Three Fiber component:
const engine = useRef(new AutoZEngine())

// After GLTF loads:
await engine.current.initialize(snapshot, gltf.scene, threeScene, camera)

// Per frame:
useFrame((state, dt) => engine.current.update(dt, state.clock.elapsedTime))

// Interact:
engine.current.open('auto_door_front_left_Door_FL')
engine.current.toggle('auto_light_head_front_left_Headlight_L')
engine.current.setColor('auto_body_Body', '#c90000')
```

---

## Naming Guide for 3D Artists

To get the **best auto-detection results**, name your mesh objects using these patterns:

```
Doors:       Door_FL, Door_FR, Door_RL, Door_RR
Hood:        Bonnet, Hood, Engine_Cover
Trunk:       Trunk, Tailgate, Boot
Mirrors:     Mirror_L, Mirror_R, Side_Mirror_Left
Headlights:  Headlight_L, Headlight_R, HL_Left
Taillights:  Taillight_L, Taillight_R, Brake_Light_L
Indicators:  Indicator_FL, Blinker_FR, Turn_Signal_FL
Wheels:      Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR
Rims:        Rim_FL, Hubcap_FR
Body:        Body, Shell, Exterior, Paint
Glass:       Windshield, Rear_Glass, Side_Window
Spoiler:     Spoiler, Rear_Wing
Fuel Cap:    Fuel_Cap, Gas_Door
Charge Port: Charge_Port, EV_Port
Sunroof:     Sunroof, Panoramic_Roof
Bumpers:     Front_Bumper, Rear_Bumper
Grille:      Grille, Front_Grille, Radiator
```

> **Tip:** The engine handles camelCase (`DoorFrontLeft`), snake_case (`door_front_left`), PascalCase (`DoorFL`), and Blender suffixes (`.001`, `.002`) automatically.
