# AutoZ Engine — Blender Part Naming & Origin Guide

> **Audience:** 3D artists / riggers exporting GLB/GLTF from Blender for the AutoZ platform.

---

## 1. How the Detection Algorithm Works

The engine runs a **3-stage scoring pipeline** on every mesh name in the scene. No manual tagging is needed — you just have to follow the naming rules below.

```
Stage 1: Exact Token Match  → score 0.95 (highest confidence)
Stage 2: Regex Pattern Match → score 0.80
Stage 3: Fuzzy Match         → score 0.00–0.70 (Levenshtein + Jaccard + n-gram)
                               × weight multiplier per part type
                               → clamped to [0, 1]

Threshold: Any score < 0.45 is DISCARDED (unmatched mesh)
```

### Stage 1 — Exact Token Match
Your Blender mesh name is normalized first:
- Blender duplicate suffixes are **stripped**: `Door_FL.001` → `Door_FL`
- camelCase is split: `FrontLeftDoor` → `front_left_door`
- All separators (`-`, `.`, ` `) → `_`
- Lowercase everything

Then it checks for an **exact match or substring match** against known tokens like `door_fl`, `doorfl`, `door_front_left`, `tuer_vl`, `porte_avg`, etc.

**→ Always aim for Stage 1 hits. They are the most reliable.**

### Stage 2 — Regex Pattern Match
The engine runs ~5–8 compiled regex patterns per part. For example, for the front-left door:
```
/\bdoor[_.\s-]?f[_.\s-]?l\b/i
/\bfront[_.\s-]?left[_.\s-]?door/i
/\bdriver[_.\s-]?door/i
```

### Stage 3 — Fuzzy Match
Last resort. Uses **Jaccard** (token set overlap) + **Levenshtein** (edit distance) + **bigram similarity**. Typos and near-misses can still match here but with lower confidence. **Don't rely on this stage for production models.**

---

## 2. Canonical typeKey Taxonomy

The `typeKey` is the engine's internal dot-notation identifier. Every part you create maps to one of these. The format is:

```
category.position.side
```

| typeKey | Label | Category | Interaction |
|---|---|---|---|
| `body` | Body Shell | body | color_change |
| `door.front.left` | Front Left Door | door | hinge_open_close |
| `door.front.right` | Front Right Door | door | hinge_open_close |
| `door.rear.left` | Rear Left Door | door | hinge_open_close |
| `door.rear.right` | Rear Right Door | door | hinge_open_close |
| `bonnet.front` | Bonnet / Hood | bonnet | hinge_open_close |
| `bonnet.rear` | Trunk / Tailgate | trunk | hinge_open_close |
| `light.head.front.left` | Left Headlight | light | toggle |
| `light.head.front.right` | Right Headlight | light | toggle |
| `light.tail.rear.left` | Left Taillight | light | toggle |
| `light.tail.rear.right` | Right Taillight | light | toggle |
| `light.indicator.front.left` | Front Left Indicator | light | blink |
| `light.indicator.front.right` | Front Right Indicator | light | blink |
| `wheel.front.left` | Front Left Wheel | wheel | spin |
| `wheel.front.right` | Front Right Wheel | wheel | spin |
| `wheel.rear.left` | Rear Left Wheel | wheel | spin |
| `wheel.rear.right` | Rear Right Wheel | wheel | spin |
| `rim.front.left` | Front Left Rim | rim | color_change |
| `mirror.left` | Left Mirror | mirror | fold |
| `mirror.right` | Right Mirror | mirror | fold |
| `glass.windshield` | Windshield | glass | tint |
| `glass.rear` | Rear Window | glass | tint |
| `glass.side` | Side Windows | glass | tint |
| `roof.sunroof` | Sunroof | roof | slide |
| `cap.fuel` | Fuel Cap | cap | hinge_open_close |
| `cap.charge` | Charging Port | cap | hinge_open_close |
| `spoiler` | Spoiler | spoiler | extend |
| `bumper.front` | Front Bumper | bumper | none |
| `bumper.rear` | Rear Bumper | bumper | none |
| `grille` | Grille | grille | none |

---

## 3. Blender Mesh Naming Cheatsheet

Use **exactly** these names in Blender (or any from the same row — engine accepts all variants):

| Part | ✅ Recommended Name | Also Accepted |
|---|---|---|
| Body / Paint | `body` | `shell`, `chassis`, `paint`, `exterior`, `bodywork` |
| Front Left Door | `Door_FL` | `door_front_left`, `frontleftdoor`, `driver_door`, `fl_door` |
| Front Right Door | `Door_FR` | `door_front_right`, `frontrightdoor`, `passenger_door`, `fr_door` |
| Rear Left Door | `Door_RL` | `door_rear_left`, `rearleftdoor`, `rl_door` |
| Rear Right Door | `Door_RR` | `door_rear_right`, `rearrightdoor`, `rr_door` |
| Hood / Bonnet | `bonnet` | `hood`, `engine_cover`, `front_bonnet`, `front_hood` |
| Trunk / Tailgate | `trunk` | `tailgate`, `boot`, `decklid`, `liftgate`, `rear_lid` |
| Left Headlight | `headlight_l` | `headlight_left`, `hl_left`, `head_light_l` |
| Right Headlight | `headlight_r` | `headlight_right`, `hl_right`, `head_light_r` |
| Left Taillight | `taillight_l` | `tail_light_left`, `tl_left`, `rearlight_l` |
| Right Taillight | `taillight_r` | `tail_light_right`, `tl_right`, `rearlight_r` |
| Front Left Indicator | `indicator_fl` | `turn_signal_fl`, `blinker_fl` |
| Front Right Indicator | `indicator_fr` | `turn_signal_fr`, `blinker_fr` |
| Front Left Wheel | `wheel_fl` | `tire_fl`, `tyre_fl` |
| Front Right Wheel | `wheel_fr` | `tire_fr`, `tyre_fr` |
| Rear Left Wheel | `wheel_rl` | `tire_rl`, `tyre_rl` |
| Rear Right Wheel | `wheel_rr` | `tire_rr`, `tyre_rr` |
| Front Left Rim | `rim_fl` | `hubcap_fl` |
| Left Mirror | `mirror_l` | `mirror_left`, `side_mirror_l`, `wing_mirror_l` |
| Right Mirror | `mirror_r` | `mirror_right`, `side_mirror_r`, `wing_mirror_r` |
| Windshield | `windshield` | `windscreen`, `front_glass`, `frontglass` |
| Rear Window | `rear_glass` | `rear_window`, `back_glass` |
| Side Windows | `side_glass` | `side_window`, `window_glass` |
| Sunroof | `sunroof` | `moonroof`, `panoramic_roof` |
| Fuel Cap | `fuel_cap` | `gas_cap`, `filler_cap`, `fuel_door` |
| Charging Port | `charge_port` | `charging_port`, `ev_port`, `charge_door` |
| Spoiler | `spoiler` | `rear_wing`, `wing`, `rear_spoiler` |
| Front Bumper | `front_bumper` | `bumper_front` |
| Rear Bumper | `rear_bumper` | `bumper_rear` |
| Grille | `grille` | `grill`, `front_grille`, `radiator_grille` |

> [!TIP]
> Blender adds `.001`, `.002` suffixes to duplicated names. The engine **automatically strips** these. `Door_FL.001` and `Door_FL.002` both resolve to `door.front.left`.

---

## 4. Origin Placement Rules (The Critical Part)

The **origin** in Blender is the pivot point the engine rotates around. Getting this wrong = wrong animation.

### Convention Reference Frame

```
AutoZ / Three.js uses a RIGHT-HANDED, Y-UP coordinate system.
Car faces +Z (nose forward). +X is car's right side (passenger side).

      Y
      |
      |_____ X  (passenger right)
     /
    Z  (nose of car)
```

### 4.1 Doors — `door.front.left` / `door.front.right` / `door.rear.*`

**Origin = at the hinge edge of the door (the A-pillar or B-pillar edge)**

```
  A-pillar          B-pillar
    │◄── ORIGIN        │
    │                  │
    │  Front Left Door │
    │                  │
    │ ← hinge side     │
```

- **Front Left Door**: Origin at the **front vertical edge** (A-pillar), Y-up.
- **Front Right Door**: Origin at the **front vertical edge** (A-pillar), Y-up.
- **Rear Left / Right Door**: Origin at the **front vertical edge** (B-pillar), Y-up.
- The pivot must be flush with the hinge line. Move the origin to the hinge rail, not the door center.
- The door should open outward. The engine applies a `65°` rotation on the **Y-axis** (+ for left side, − for right side) to animate opening.

> [!IMPORTANT]
> In Blender: select the door mesh → Edit Mode → snap 3D cursor to the hinge edge → Object Mode → `Object > Set Origin > Origin to 3D Cursor`.

### 4.2 Bonnet / Hood — `bonnet.front`

**Origin = at the rear hinge line of the bonnet (near the windshield base)**

```
  Windshield side
       ↑
  ORIGIN ←──── rear hinge line (near firewall)
       │
       │  Hood panel
       │
  Front bumper side
```

- The engine rotates on the **X-axis** by `-65°` (lifts forward-and-up).
- The origin must be on the hinge axis — a straight line running left-to-right (parallel to X axis), at the rear of the bonnet.
- **Height**: at the top surface of the car body where the hinge is.

### 4.3 Trunk / Tailgate — `bonnet.rear`

**Origin = at the top hinge line of the trunk lid (near the rear roof/C-pillar)**

```
  Rear roof edge
  ORIGIN ←──── top hinge line (near C-pillar base)
       │
       │  Trunk lid panel
       │
  Rear bumper side
```

- The engine rotates on the **X-axis** by `+60°` (lifts upward and back).
- Origin must be at the **top edge** of the trunk panel (hinge side), not the center.

### 4.4 Wheels — `wheel.front.*` / `wheel.rear.*`

**Origin = geometric center of the wheel (axle center)**

```
     ┌───┐
    (  ✦  ) ← ORIGIN at axle center
     └───┘
```

- Must be **exactly** on the axle center — centered in X, Y, and Z of the wheel geometry.
- The engine spins on the **X-axis** continuously.
- All four wheels: same rule. Use `Object > Set Origin > Origin to Geometry` if the geometry is perfectly symmetrical.

> [!CAUTION]
> Do NOT zero the origin to world origin. Each wheel's origin must be at **its own** axle center in local world space.

### 4.5 Mirrors — `mirror.left` / `mirror.right`

**Origin = at the base/hinge point where the mirror arm meets the door**

```
  Door surface
      │
  ORIGIN ← mirror arm base / hinge
      │
    [mirror head]
```

- Left mirror folds on the **+Y axis** by `-80°` (folds toward car).
- Right mirror folds on the **-Y axis** by `+80°` (folds toward car).
- The origin must be at the point where the mirror arm rotates — not the mirror face center.

### 4.6 Fuel Cap / Charging Port — `cap.fuel` / `cap.charge`

**Origin = at the hinge edge of the flap**

```
  Car body
  │   ╔═══════╗
  │   ║  cap  ║
  │   ╚═ORIGIN╝ ← hinge edge (Y-axis)
  │
```

- The engine opens on the **Y-axis** by `90°`.
- Place origin at the hinge edge of the flap, not its center.

### 4.7 Sunroof — `roof.sunroof`

**Origin = front edge of the sunroof panel**

```
  Front of roof
  ORIGIN ←──── front edge of glass
  ┌─────────────────────┐
  │     sunroof panel   │
  └─────────────────────┘
  Back of roof
```

- The engine **slides** the panel (translation along Z-axis).
- Origin at the front edge — this is the fixed point during the slide.

### 4.8 Spoiler — `spoiler`

**Origin = rear base/mounting point of the spoiler**

```
  Trunk lid / rear deck
       ↑
  ORIGIN ←──── mounting base of spoiler
       │
    ╔══╧══╗
    ║wing ║
    ╚═════╝
```

- The engine extends on the **X-axis** by `25°` (rises up and back).
- Origin at the base mounting point where the spoiler attaches to the body.

### 4.9 Body Shell — `body`

**Origin = world origin (0, 0, 0) or the car's local center**

- The body is the parent of all other parts in most rigs.
- No animation applied, only material/color changes.
- Conventionally, place the car so the body origin is at ground level, centered horizontally, at the car's midpoint along the length.

### 4.10 Lights, Glass, Grille, Bumpers

**Origin = geometric center of the mesh** (use `Set Origin > Origin to Geometry`)

- These parts have no hinge animation (`toggle`, `tint`, `none`).
- The origin position doesn't affect their function, but centering is best practice for material targeting.

---

## 5. Naming Pattern Rules Summary

| Rule | Detail |
|---|---|
| **Separator** | `_` (underscore) preferred. `.`, `-`, space also work. |
| **Position codes** | `FL` = front-left, `FR` = front-right, `RL` = rear-left, `RR` = rear-right |
| **Side codes** | `_L` = left, `_R` = right |
| **Case** | Case-insensitive. `Door_FL`, `door_fl`, `DOOR_FL` all match. |
| **Duplicate suffix** | Blender `.001` etc. are auto-stripped. |
| **Hierarchy** | Parent-child relationships in Blender are ignored by the detector; only the mesh **name** matters. |
| **Multi-mesh parts** | You can assign multiple meshes to one part via the config JSON. Name them `headlight_l_outer`, `headlight_l_inner` — both will match `light.head.front.left`. |

---

## 6. Gotchas & Anti-Patterns

> [!WARNING]
> **Don't name everything "Mesh"** — default Blender names like `Mesh.001`, `Mesh.002` score `0.0` and go into the **unmatched** bucket. Always rename before exporting.

> [!WARNING]
> **Avoid ambiguous names** — `light` alone is too generic and may match any light type with a low fuzzy score. Always include position: `headlight_l`, not just `light`.

> [!WARNING]
> **Origin ≠ Geometry Center for hinged parts** — Never use "Origin to Geometry" for doors, bonnet, trunk, mirrors, or fuel caps. The geometry center is almost never the hinge point.

> [!NOTE]
> **Weight system** — If two parts score similarly for the same mesh, the one with higher `weight` in the taxonomy wins. Doors (1.5) beat body (1.0), for example. This prevents `body` from stealing door meshes.

> [!NOTE]
> **Threshold = 0.45** — Any mesh scoring below 45% confidence is left in the `unmatched` list. You can override via `config.parts[]` in your project JSON to manually assign any unmatched mesh.

---

## 7. Quick Blender Workflow

```
1. Model the car as separate objects (one object per interactive part)
2. Name each object using the recommended names from Section 3
3. For each ANIMATED part, set the origin to the HINGE/PIVOT point (Section 4)
4. For static parts, use Origin to Geometry
5. Apply all transforms: Ctrl+A → All Transforms
6. Export as GLB:
   - ✅ Apply Modifiers
   - ✅ Include: Mesh, Materials, Normals
   - ❌ Don't embed cameras/lights unless needed
7. Upload to AutoZ — the engine detects and wires everything automatically
```
