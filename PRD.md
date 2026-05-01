---
title: "AutoZ Engine - Final Product Requirements Document"
subtitle: "Config-driven 3D automotive viewer, interaction engine, and iframe publisher"
author: "AutoZ Product Team"
date: "2026-04-30"
geometry: margin=0.7in
fontsize: 10pt
---

# AutoZ Engine - Final Product Requirements Document

**Product name:** AutoZ Engine  
**Version:** PRD v1.0  
**Date:** 2026-04-30  
**Primary deliverable:** Web-based editor + runtime viewer + Supabase-backed publishing system  
**Core route:** `/view/:publishId`  
**Embed output:** iframe

---

## 1. Executive Summary

AutoZ Engine is a web-based 3D automotive visualization platform that lets automotive companies upload a vehicle model, normalize it, configure interactive parts, tune the entire 3D viewing environment, save the full configuration to Supabase, and publish the result as a stable iframe.

The product is built around one principle:

```txt
Everything is configuration.
Everything is saved.
Everything is reproducible from publishId.
```

The final runtime viewer is not manually coded per car. The runtime viewer is generated from a saved JSON snapshot:

$$
AutoZViewer = f(Model, Normalization, Parts, Interactions, Materials, Scene, Lighting, Reflection, Camera, UI, Performance)
$$

A customer should be able to:

1. Upload a car model.
2. Normalize size, direction, origin, ground alignment, and viewport fit.
3. Tag parts: doors, bonnet, trunk, headlights, taillights, wheels, mirrors, body, windows, roof, fuel cap, charging port, etc.
4. Configure interactions: open/close, toggle lights, change body color, rotate/focus, show 3D radial buttons.
5. Configure the 3D scene: lighting, reflection, shadows, HDRI, camera, environment, tone mapping, bloom, and quality mode.
6. Store every setting in Supabase.
7. Publish an immutable snapshot.
8. Embed it anywhere using an iframe.

---

## 2. Product Positioning

AutoZ Engine is not just a 3D viewer and not just a car configurator.

It is:

> A declarative 3D automotive rendering and interaction engine powered by stored configuration.

### One-line pitch

> Upload a car model, define the parts, tune the lighting and reflections, and publish a production-ready interactive 3D car experience as an iframe.

### Market framing

AutoZ Engine is closest to:

- A lightweight Unity-like runtime for automotive web experiences.
- A Figma-like editor for 3D car interaction setup.
- A Shopify-like iframe publisher for interactive vehicle pages.

---

## 3. Goals and Non-Goals

## 3.1 Goals

- Let non-3D-engineering users configure an interactive car viewer.
- Normalize imported models so they appear consistently in the viewport.
- Let users manually tag parts and define behavior.
- Save all model, scene, interaction, environment, and UI configuration to Supabase.
- Use ImgBB for image-like public visual assets.
- Use Supabase Storage for 3D/runtime-heavy assets.
- Publish a stable snapshot to `/view/:publishId`.
- Generate iframe code for external websites.
- Keep graphics premium while controlling GPU usage.

## 3.2 Non-goals for MVP

- Full CAD conversion.
- AI part detection.
- AR/VR showroom.
- Physics simulation.
- Real vehicle telemetry.
- Multiplayer editing.
- Real-time ray-traced reflections.
- Full game-engine scripting.

---

## 4. System Architecture

```txt
[AutoZ Editor]
React + React Three Fiber + Three.js
        |
        | save draft config, assets, metadata
        v
[Supabase]
Postgres + Auth + Storage + Edge Functions
        |
        | publish immutable snapshot
        v
[Runtime Viewer]
/view/:publishId
        |
        | iframe embed
        v
[Customer Website]
```

## 4.1 Core applications

| Module | Purpose |
|---|---|
| Editor App | Upload model, normalize it, tag parts, configure scene, preview, publish |
| Runtime Viewer | Public viewer that renders a published snapshot from `/view/:publishId` |
| Supabase Backend | Stores configs, snapshots, metadata, runtime files, and auth data |
| ImgBB Upload Layer | Stores image-like assets such as thumbnails and preview images |

---

## 5. Asset Storage Architecture

AutoZ uses a hybrid asset storage model.

```txt
Image-like visual assets -> ImgBB
3D/runtime-heavy assets -> Supabase Storage
All URLs and metadata -> Supabase Postgres
Publish snapshots -> Supabase Postgres JSONB
```

## 5.1 ImgBB usage

Use ImgBB for image-like assets:

- Project thumbnails
- Generated preview renders
- Viewer preview screenshots
- Editor screenshots
- Publish preview cards
- UI background raster images
- Material swatch images
- Marketing preview images

ImgBB API v1 supports image uploads using an API key and accepts binary files, base64 data, or remote image URLs. POST should be preferred for local uploads because GET requests are limited by URL length.

## 5.2 Supabase Storage usage

Use Supabase Storage for runtime-heavy assets:

- `.glb`
- `.gltf`
- `.fbx`
- `.obj`
- `.bin`
- `.hdr`
- `.exr`
- `.ktx2`
- Draco assets
- Meshopt compressed assets
- Optimized model files
- Runtime config backup files if needed

## 5.3 Hard rule

```txt
If an asset is required by the 3D runtime engine, store it in Supabase Storage.
If an asset is only a visual preview/image/UI asset, store it in ImgBB.
```

## 5.4 Asset classification table

| Asset | Storage provider | Runtime-critical? |
|---|---|---:|
| Car thumbnail | ImgBB | No |
| Publish preview image | ImgBB | No |
| Editor screenshot | ImgBB | No |
| UI background image | ImgBB | No, unless used as viewer background |
| Material swatch image | ImgBB | No |
| GLB model | Supabase Storage | Yes |
| GLTF model | Supabase Storage | Yes |
| HDRI lighting file | Supabase Storage | Yes |
| EXR environment file | Supabase Storage | Yes |
| KTX2 compressed texture | Supabase Storage | Yes |
| Draco geometry | Supabase Storage | Yes |
| JSON publish snapshot | Supabase DB | Yes |
| Draft config | Supabase DB | Yes |

---

## 6. Recommended Tech Stack

## 6.1 Frontend and 3D

| Layer | Recommended library |
|---|---|
| App framework | Next.js |
| UI framework | React |
| 3D engine | Three.js |
| React 3D renderer | `@react-three/fiber` |
| 3D helpers | `@react-three/drei` |
| Editor state | Zustand |
| Forms | React Hook Form |
| Config validation | Zod |
| Animation | GSAP + internal damping formulas |
| Debug controls | Leva |
| Backend SDK | Supabase JS |

React Three Fiber is recommended because it is a React renderer for Three.js. Three.js remains the underlying rendering engine. Drei should be used for helpers such as Environment, Html overlays, contact shadows, camera helpers, performance monitoring, and adaptive DPR.

## 6.2 Asset processing

| Requirement | Recommended tool |
|---|---|
| Read/write GLB/GLTF | glTF-Transform |
| Remove unused data | glTF-Transform `prune()` |
| Deduplicate data | glTF-Transform `dedup()` |
| Geometry compression | Draco or Meshopt |
| Texture compression | KTX2/BasisU or WebP |
| GPU-oriented GLTF optimization | gltfpack |
| Runtime loading | Three.js `GLTFLoader` |
| Runtime KTX2 textures | Three.js `KTX2Loader` |
| Runtime Draco geometry | Three.js `DRACOLoader` |
| Runtime Meshopt geometry | `GLTFLoader.setMeshoptDecoder()` |

## 6.3 Why these tools

- **Three.js**: mature WebGL/WebGPU-capable 3D foundation.
- **React Three Fiber**: declarative React integration for Three.js.
- **Drei**: production helpers for common R3F tasks.
- **Supabase**: Postgres, Storage, Auth, Edge Functions, and JS client in one backend.
- **ImgBB**: simple image hosting for public image-like visual assets.
- **glTF-Transform**: scriptable asset optimization and GLB/GLTF transformation.
- **gltfpack / meshoptimizer**: optimized delivery for smaller, faster GLB files.
- **KTX2/BasisU**: better GPU texture memory behavior than raw PNG/JPG textures.
- **GSAP**: timeline-based animation for camera focus and cinematic transitions.

---

## 7. Core User Flow

```txt
Create project
   |
Upload model
   |
Import + normalize model
   |
Preview normalized model
   |
Tag car parts
   |
Configure interactions
   |
Configure materials and color variants
   |
Configure lighting, reflections, camera, environment, shadows
   |
Save draft to Supabase
   |
Preview runtime viewer
   |
Publish immutable snapshot
   |
Generate URL + iframe
```

---

## 8. Editor App Requirements

## 8.1 Editor layout

```txt
+---------------------------------------------------------------+
| Top bar: Project name | Save | Preview | Publish | Copy iframe |
+------------------+-----------------------------+--------------+
| Left panel       | 3D viewport                  | Right panel  |
| - Model          | - Car preview                | - Properties |
| - Parts          | - Mesh selection             | - Pivot      |
| - Materials      | - Pivot gizmos               | - Animation  |
| - Interactions   | - 3D radial buttons preview  | - Lighting   |
| - Scene          | - Camera controls            | - Reflection |
| - Publish        |                             | - Camera     |
+------------------+-----------------------------+--------------+
```

## 8.2 Editor capabilities

- Upload model.
- Validate file format and file size.
- Run normalization pipeline.
- Display import report.
- Show scene graph and mesh list.
- Click mesh in viewport and assign part type.
- Set part pivot and axis.
- Test hinge/open/close interaction.
- Test light toggle interaction.
- Create body color variants.
- Configure 3D radial buttons.
- Configure lighting and environment.
- Configure quality/performance preset.
- Save draft.
- Publish snapshot.
- Copy iframe code.

---

## 9. Runtime Viewer Requirements

Route:

```txt
/view/:publishId
```

The Runtime Viewer must:

1. Read `publishId` from the route.
2. Fetch publish snapshot from Supabase.
3. Validate schema version.
4. Load optimized GLB/GLTF model from Supabase Storage.
5. Load image-like visual assets from ImgBB when referenced.
6. Apply normalization transform.
7. Apply configured materials.
8. Build scene, lighting, environment, reflections, shadows, camera, and controls.
9. Register interactive parts.
10. Render 3D radial buttons.
11. Handle click/tap interactions.
12. Apply performance adaptation.
13. Pause rendering when iframe is not visible.

Runtime equation:

$$
RenderedScene = f(Snapshot_{publishId})
$$

---

## 10. Supabase Data Model

## 10.1 `projects`

```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid,
  status text default 'draft',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

## 10.2 `assets`

This table stores URLs and metadata for both ImgBB and Supabase Storage assets.

```sql
create table assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  asset_type text not null,
  storage_provider text not null,
  public_url text not null,
  storage_path text,
  mime_type text,
  file_name text,
  file_size_bytes bigint,
  width integer,
  height integer,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
```

Recommended `storage_provider` values:

```txt
imgbb
supabase_storage
external_url
```

Recommended `asset_type` values:

```txt
original_model
optimized_model
environment_hdri
environment_exr
compressed_texture
project_thumbnail
publish_preview
material_swatch
background_image
config_backup
```

## 10.3 `project_configs`

Editable draft configuration.

```sql
create table project_configs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  version integer default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

## 10.4 `publishes`

Immutable published snapshots.

```sql
create table publishes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  publish_slug text unique not null,
  snapshot jsonb not null,
  version integer not null,
  is_public boolean default true,
  created_at timestamptz default now()
);
```

## 10.5 Why snapshots should be immutable

Draft configs can change constantly, but a published iframe must remain stable. Therefore:

```txt
Draft project_config = editable
Published snapshot = frozen
```

When a user republishes, create a new snapshot version.

---

## 11. Model Import and Normalization Pipeline

## 11.1 Supported formats

MVP:

```txt
.glb
.gltf
```

Later:

```txt
.fbx
.obj
.usdz
.step
.iges
```

MVP should prefer GLB because it packages geometry, materials, textures, and scene hierarchy into one web-friendly asset.

## 11.2 Import pipeline

```txt
Upload file
   |
Validate file type and file size
   |
Store original model in Supabase Storage
   |
Read scene graph
   |
Extract meshes, nodes, materials, textures
   |
Compute raw bounding box
   |
Detect or ask source unit
   |
Normalize unit scale
   |
Normalize center and ground alignment
   |
Normalize forward direction
   |
Generate optimized GLB
   |
Generate preview thumbnail and upload to ImgBB
   |
Save asset records and import report to Supabase DB
```

---

## 12. Normalization Standards and Formulas

## 12.1 Canonical coordinate system

AutoZ must standardize every imported vehicle into one coordinate system:

```txt
X axis = left/right
Y axis = up/down
Z axis = front/back
Car front = +Z
Ground plane = Y = 0
Vehicle center = XZ center at origin
```

Canonical origin:

```txt
origin.x = center of width
origin.y = ground level
origin.z = center of length
```

## 12.2 Unit normalization

All models should be converted to meters.

$$
p_{meters} = p_{raw} \cdot u_s
$$

Where:

- $p_{raw}$ = original vertex position.
- $u_s$ = unit scale factor.
- $p_{meters}$ = vertex position in meters.

| Source unit | Unit scale `$u_s$` |
|---|---:|
| millimeter | 0.001 |
| centimeter | 0.01 |
| meter | 1.0 |
| inch | 0.0254 |
| foot | 0.3048 |

If unit cannot be detected, the editor should ask:

```txt
What unit is this model using?
[mm] [cm] [m] [inch] [foot]
```

## 12.3 Bounding box formula

For all vertices:

$$
v_i = (x_i, y_i, z_i)
$$

Minimum point:

$$
B_{min} = (\min_i x_i, \min_i y_i, \min_i z_i)
$$

Maximum point:

$$
B_{max} = (\max_i x_i, \max_i y_i, \max_i z_i)
$$

Dimensions:

$$
W = B_{max.x} - B_{min.x}
$$

$$
H = B_{max.y} - B_{min.y}
$$

$$
D = B_{max.z} - B_{min.z}
$$

Largest dimension:

$$
M = \max(W, H, D)
$$

Bounding box center:

$$
C = \frac{B_{min} + B_{max}}{2}
$$

Ground height:

$$
G = B_{min.y}
$$

## 12.4 Scale normalization

Recommended default target max dimension:

```json
{
  "targetMaxDimension": 6.0,
  "unit": "meters"
}
```

Scale factor:

$$
S = \frac{T}{M}
$$

Where:

- $S$ = scale factor.
- $T$ = target maximum dimension.
- $M$ = model maximum dimension.

Final scaled vertex:

$$
p_s = p_{meters} \cdot S
$$

## 12.5 Center normalization

To center the vehicle on the XZ origin:

$$
p_c.x = p_s.x - C_xS
$$

$$
p_c.z = p_s.z - C_zS
$$

To align the vehicle to the ground plane:

$$
p_g.y = p_s.y - GS
$$

Final centered and grounded vertex:

$$
p_n =
\begin{bmatrix}
p_s.x - C_xS \\
p_s.y - GS \\
p_s.z - C_zS
\end{bmatrix}
$$

## 12.6 Direction normalization

If the uploaded model's front direction is known:

```json
{
  "sourceForward": [1, 0, 0],
  "targetForward": [0, 0, 1]
}
```

Normalize vectors:

$$
F_s = normalize(sourceForward)
$$

$$
F_t = normalize(targetForward)
$$

Rotation axis:

$$
A = normalize(F_s \times F_t)
$$

Rotation angle:

$$
\theta = \cos^{-1}(F_s \cdot F_t)
$$

Rotation matrix:

$$
R = R_A(\theta)
$$

Final direction-normalized vertex:

$$
p_{final} = R \cdot p_n
$$

If direction cannot be detected, the editor must provide a manual control:

```txt
Front direction:
[+X] [-X] [+Z] [-Z]
```

## 12.7 Complete import normalization formula

$$
p_{final} = R_{forward} \cdot \left(S \cdot u_s \cdot p_{raw} - O\right)
$$

Where:

$$
O =
\begin{bmatrix}
C_xS \\
GS \\
C_zS
\end{bmatrix}
$$

And:

- $u_s$ = unit scale.
- $S$ = target scale factor.
- $C_x, C_z$ = bounding-box horizontal center.
- $G$ = ground offset.
- $R_{forward}$ = forward-direction correction rotation.

---

## 13. Camera Normalization Formulas

## 13.1 Bounding sphere radius

After normalization:

$$
r = \frac{1}{2}\sqrt{W^2 + H^2 + D^2} \cdot S
$$

## 13.2 Camera distance

Vertical field of view distance:

$$
d_v = \frac{H/2}{\tan(FOV_v/2)}
$$

Horizontal field of view:

$$
FOV_h = 2\tan^{-1}\left(\tan(FOV_v/2) \cdot aspect\right)
$$

Horizontal distance:

$$
d_h = \frac{W/2}{\tan(FOV_h/2)}
$$

Depth-safe camera distance:

$$
d = \max(d_v, d_h) + padding
$$

Recommended padding:

$$
padding = r \cdot 0.35
$$

Final camera distance:

$$
d_{final} = \max(d_v, d_h) + 0.35r
$$

## 13.3 Camera target

Default camera target:

$$
target =
\begin{bmatrix}
0 \\
H \cdot 0.45 \\
0
\end{bmatrix}
$$

Default camera position:

$$
camera =
\begin{bmatrix}
d \cdot 0.8 \\
d \cdot 0.45 \\
-d
\end{bmatrix}
$$

## 13.4 Near and far plane

$$
near = \max(0.01, d - 2r)
$$

$$
far = d + 4r
$$

---

## 14. Car Part Taxonomy

## 14.1 Supported parts

| Part | Type key | MVP interaction |
|---|---|---|
| Body shell | `body` | Color/material change |
| Front left door | `door.front.left` | Hinge open/close |
| Front right door | `door.front.right` | Hinge open/close |
| Rear left door | `door.rear.left` | Hinge open/close |
| Rear right door | `door.rear.right` | Hinge open/close |
| Bonnet / hood | `bonnet.front` | Hinge open/close |
| Trunk / tailgate | `bonnet.rear` | Hinge open/close |
| Left headlight | `light.head.front.left` | Toggle on/off |
| Right headlight | `light.head.front.right` | Toggle on/off |
| Left taillight | `light.tail.rear.left` | Toggle on/off |
| Right taillight | `light.tail.rear.right` | Toggle on/off |
| Indicators | `light.indicator.*` | Blink/toggle |
| Wheels | `wheel.*` | Spin/focus |
| Rims | `rim.*` | Material/color change |
| Mirrors | `mirror.*` | Fold/unfold |
| Windows/glass | `glass.*` | Tint/opacity |
| Sunroof | `roof.sunroof` | Slide/open later |
| Fuel cap | `cap.fuel` | Open/close |
| Charging port | `cap.charge` | Open/close |
| Spoiler | `spoiler` | Extend/retract later |

## 14.2 Part metadata shape

```json
{
  "id": "front_left_door",
  "label": "Front Left Door",
  "type": "door.front.left",
  "meshNames": ["Door_FL", "Handle_FL"],
  "pivot": [-1.25, 0.85, 0.9],
  "axis": [0, 1, 0],
  "anchor": [-1.45, 1.1, 0.2],
  "defaultState": "closed",
  "interactions": ["open_close_front_left_door"],
  "visibleInUI": true
}
```

| Field | Meaning |
|---|---|
| `meshNames` | Meshes controlled by the part |
| `pivot` | World-space hinge point |
| `axis` | Normalized hinge rotation axis |
| `anchor` | Position where radial UI appears |
| `defaultState` | Initial open/closed/on/off state |
| `interactions` | Linked interaction IDs |
| `visibleInUI` | Whether the part appears as clickable UI |

---

## 15. Pivot Editing System

## 15.1 Pivot presets

For a selected mesh, AutoZ should offer:

```txt
Left edge
Right edge
Front edge
Rear edge
Top edge
Bottom edge
Center
Custom
```

## 15.2 Pivot from selected mesh bounding box

For selected part bounding box $B_{min}, B_{max}$:

Left edge pivot:

$$
P_{left} =
\begin{bmatrix}
B_{min.x} \\
(B_{min.y}+B_{max.y})/2 \\
(B_{min.z}+B_{max.z})/2
\end{bmatrix}
$$

Right edge pivot:

$$
P_{right} =
\begin{bmatrix}
B_{max.x} \\
(B_{min.y}+B_{max.y})/2 \\
(B_{min.z}+B_{max.z})/2
\end{bmatrix}
$$

Front edge pivot:

$$
P_{front} =
\begin{bmatrix}
(B_{min.x}+B_{max.x})/2 \\
(B_{min.y}+B_{max.y})/2 \\
B_{max.z}
\end{bmatrix}
$$

Rear edge pivot:

$$
P_{rear} =
\begin{bmatrix}
(B_{min.x}+B_{max.x})/2 \\
(B_{min.y}+B_{max.y})/2 \\
B_{min.z}
\end{bmatrix}
$$

---

## 16. Interaction Mechanics and Formulas

## 16.1 Hinge rotation formula

For doors, bonnet, trunk, fuel caps, charging caps, mirrors, and similar hinged parts, use pivot-based rotation.

Given:

- Point $p$
- Pivot point $P$
- Normalized hinge axis $a$
- Rotation angle $\theta$

Offset from pivot:

$$
v = p - P
$$

Rodrigues rotation:

$$
R_a(\theta)v = v\cos\theta + (a \times v)\sin\theta + a(a \cdot v)(1 - \cos\theta)
$$

Final point:

$$
p' = P + R_a(\theta)(p - P)
$$

## 16.2 Smooth animation formula

Use exponential damping:

$$
\theta_{next} = \theta_{current} + (\theta_{target} - \theta_{current})(1 - e^{-\lambda \Delta t})
$$

Where:

- $\theta_{current}$ = current angle.
- $\theta_{target}$ = target open/closed angle.
- $\lambda$ = damping speed.
- $\Delta t$ = frame delta time.

Recommended values:

```json
{
  "lambda": 8,
  "openAngleDegrees": 65,
  "closeAngleDegrees": 0
}
```

## 16.3 Door hinge presets

Canonical coordinate system:

```txt
X = left/right
Y = up
Z = front/back
front = +Z
```

| Door style | Pivot location | Axis | Notes |
|---|---|---|---|
| Normal door | Front vertical edge | `[0, 1, 0]` | Standard car door |
| Suicide door | Rear vertical edge | `[0, 1, 0]` | Rear-hinged door |
| Gullwing | Roof edge | `[0, 0, 1]` or custom | Opens upward |
| Scissor | Front lower hinge | Custom angled axis | Opens upward/forward |
| Butterfly | Front hinge | Compound axis | Upward + outward |
| Sliding | Side rail | Translation path | Future phase |

MVP supported styles:

```txt
normal
suicide
gullwing
custom
```

## 16.4 Bonnet / hood hinge config

```json
{
  "partType": "bonnet.front",
  "pivotLocation": "rear_edge_of_bonnet",
  "axis": [1, 0, 0],
  "closedAngle": 0,
  "openAngle": -65
}
```

## 16.5 Rear trunk / tailgate hinge config

```json
{
  "partType": "bonnet.rear",
  "pivotLocation": "rear_upper_edge",
  "axis": [1, 0, 0],
  "closedAngle": 0,
  "openAngle": 60
}
```

## 16.6 Light toggle formula

For headlights, taillights, indicators, and DRLs:

$$
I_{next} = I_{current} + (I_{target} - I_{current})(1 - e^{-\lambda \Delta t})
$$

Where:

- $I$ = emissive intensity.
- OFF target = 0.
- ON target = configured intensity.

Example:

```json
{
  "off": {
    "emissiveIntensity": 0
  },
  "on": {
    "emissiveColor": "#fff4cc",
    "emissiveIntensity": 4.5
  }
}
```

## 16.7 Indicator blink formula

Hard blink:

$$
I(t) = I_{max} \cdot step(0.5, \sin(2\pi ft))
$$

Smooth blink:

$$
I(t) = I_{max} \cdot \frac{1 + \sin(2\pi ft)}{2}
$$

Recommended frequency:

$$
f = 1.5Hz
$$

## 16.8 Body color interpolation

$$
C_{next} = lerp(C_{current}, C_{target}, \alpha)
$$

Where:

$$
\alpha = 1 - e^{-\lambda \Delta t}
$$

Example material:

```json
{
  "baseColor": "#c90000",
  "metalness": 0.75,
  "roughness": 0.28,
  "clearcoat": 1.0,
  "clearcoatRoughness": 0.15
}
```

---

## 17. 3D Radial Button System

## 17.1 UX behavior

When a user clicks a part, AutoZ shows contextual 3D/radial controls near that part.

Examples:

```txt
Click headlight -> radial button: On/Off
Click door -> radial buttons: Open/Close, Focus
Click body -> radial buttons: Color, Material, Reset
Click trunk -> radial buttons: Open/Close
```

## 17.2 Radial button world positioning

Let:

- $A$ = selected part anchor position.
- $R_c$ = camera right vector.
- $U_c$ = camera up vector.
- $n$ = number of buttons.
- $i$ = button index.
- $r_b$ = radial distance.

Angle:

$$
\phi_i = \frac{2\pi i}{n}
$$

Button world position:

$$
B_i = A + r_b(\cos(\phi_i)R_c + \sin(\phi_i)U_c)
$$

This makes buttons appear radially outward around the selected part and face the camera.

## 17.3 Constant visual button size

To keep button size visually consistent regardless of camera distance:

$$
scale_i = k \cdot distance(camera, B_i) \cdot \tan(FOV/2)
$$

Recommended:

$$
k = 0.035
$$

## 17.4 World-to-screen projection for HTML buttons

For HTML overlay buttons:

$$
clip = P \cdot V \cdot M \cdot
\begin{bmatrix}
x \\
y \\
z \\
1
\end{bmatrix}
$$

$$
ndc = \frac{clip.xyz}{clip.w}
$$

Screen coordinates:

$$
screen_x = (ndc_x \cdot 0.5 + 0.5) \cdot viewportWidth
$$

$$
screen_y = (-ndc_y \cdot 0.5 + 0.5) \cdot viewportHeight
$$

MVP recommendation:

```txt
Use 3D world buttons for premium viewer UI.
Use HTML overlay buttons for editor controls and accessibility fallback.
```

---

## 18. View Engine Configuration JSON

The published viewer must be generated from a single saved snapshot.

## 18.1 Full publish snapshot shape

```json
{
  "schemaVersion": "1.0.0",
  "publish": {
    "publishId": "sedan-red-studio-82fa",
    "projectId": "project_123",
    "version": 7,
    "createdAt": "2026-04-30T10:00:00.000Z",
    "isPublic": true
  },
  "assets": {
    "model": {
      "provider": "supabase_storage",
      "type": "optimized_model",
      "url": "https://xyz.supabase.co/storage/v1/object/public/models/car.optimized.glb",
      "format": "glb"
    },
    "thumbnail": {
      "provider": "imgbb",
      "type": "project_thumbnail",
      "url": "https://i.ibb.co/example/car-thumbnail.webp",
      "format": "webp"
    },
    "previewImage": {
      "provider": "imgbb",
      "type": "publish_preview",
      "url": "https://i.ibb.co/example/viewer-preview.webp",
      "format": "webp"
    },
    "environment": {
      "provider": "supabase_storage",
      "type": "environment_hdri",
      "url": "https://xyz.supabase.co/storage/v1/object/public/environments/studio.hdr",
      "format": "hdr"
    }
  },
  "import": {
    "unitScale": 1,
    "sourceUnit": "meters",
    "sourceForward": [0, 0, -1],
    "targetForward": [0, 0, 1],
    "targetMaxDimension": 6,
    "boundingBoxRaw": {
      "min": [-2.1, 0.02, -4.5],
      "max": [2.1, 1.7, 4.5]
    },
    "boundingBoxNormalized": {
      "min": [-1.4, 0, -3],
      "max": [1.4, 1.12, 3]
    },
    "normalization": {
      "scale": 0.6667,
      "centerOffset": [0, 0, 0],
      "groundOffset": 0.02,
      "rotationEuler": [0, 3.14159, 0],
      "rotationQuaternion": [0, 1, 0, 0]
    }
  },
  "renderer": {
    "engine": "threejs",
    "colorSpace": "srgb",
    "toneMapping": "aces",
    "toneMappingExposure": 1.1,
    "antialias": true,
    "alpha": true,
    "powerPreference": "high-performance",
    "pixelRatio": {
      "desktop": [1, 1.75],
      "mobile": [1, 1.25]
    }
  },
  "scene": {
    "background": {
      "type": "transparent",
      "provider": null,
      "url": null,
      "color": "#000000",
      "fit": "cover",
      "position": "center"
    },
    "environment": {
      "type": "hdri",
      "provider": "supabase_storage",
      "preset": "studio",
      "url": "https://xyz.supabase.co/storage/v1/object/public/environments/studio.hdr",
      "intensity": 1.0,
      "rotation": [0, 0.35, 0],
      "blur": 0.25,
      "visibleAsBackground": false
    },
    "ground": {
      "enabled": true,
      "type": "shadowCatcher",
      "size": 20,
      "color": "#111111",
      "roughness": 0.8,
      "metalness": 0,
      "opacity": 0.35
    }
  },
  "lighting": {
    "preset": "studio_soft",
    "ambient": {
      "enabled": true,
      "color": "#ffffff",
      "intensity": 0.35
    },
    "lights": [
      {
        "id": "key",
        "type": "directional",
        "position": [4, 6, -4],
        "target": [0, 0.8, 0],
        "color": "#ffffff",
        "intensity": 2.2,
        "castShadow": true
      },
      {
        "id": "fill",
        "type": "directional",
        "position": [-4, 3, 3],
        "target": [0, 0.8, 0],
        "color": "#dbeafe",
        "intensity": 0.8,
        "castShadow": false
      },
      {
        "id": "rim",
        "type": "directional",
        "position": [0, 4, 6],
        "target": [0, 1, 0],
        "color": "#ffffff",
        "intensity": 1.1,
        "castShadow": false
      }
    ]
  },
  "reflection": {
    "enabled": true,
    "source": "environment",
    "intensity": 0.8,
    "materialMultipliers": {
      "body": 1.0,
      "glass": 1.35,
      "chrome": 1.5,
      "rubber": 0.1
    },
    "floorReflection": {
      "enabled": false,
      "mode": "fake_blurred",
      "opacity": 0.25,
      "blur": 0.6,
      "resolution": 512
    }
  },
  "shadows": {
    "enabled": true,
    "type": "contact",
    "opacity": 0.55,
    "blur": 1.6,
    "resolution": 512,
    "frames": 1,
    "directionalShadow": {
      "enabled": false,
      "mapSize": 1024,
      "bias": -0.0001,
      "normalBias": 0.02
    }
  },
  "camera": {
    "type": "perspective",
    "fov": 40,
    "near": 0.01,
    "far": 100,
    "position": [4.2, 2.4, -6.2],
    "target": [0, 0.8, 0],
    "autoFit": true,
    "fitPadding": 0.35,
    "focus": {
      "enabled": true,
      "duration": 0.65,
      "easing": "power3.out",
      "partPadding": 0.5
    },
    "controls": {
      "type": "orbit",
      "enabled": true,
      "enablePan": false,
      "enableZoom": true,
      "enableDamping": true,
      "dampingFactor": 0.08,
      "minDistance": 2.2,
      "maxDistance": 9.5,
      "minPolarAngle": 0.35,
      "maxPolarAngle": 1.45,
      "autoRotate": false,
      "autoRotateSpeed": 0.4
    }
  },
  "postProcessing": {
    "enabled": true,
    "bloom": {
      "enabled": false,
      "intensity": 0.25,
      "threshold": 1.1,
      "radius": 0.4
    },
    "colorGrade": {
      "enabled": true,
      "contrast": 1.05,
      "saturation": 1.02,
      "brightness": 1.0
    },
    "antiAliasing": {
      "type": "smaa",
      "enabled": true
    }
  },
  "materials": [],
  "parts": [],
  "interactions": [],
  "ui3d": {},
  "performance": {}
}
```

---

## 19. Material Configuration

## 19.1 Car paint

```json
{
  "id": "body_paint_red",
  "target": "body",
  "meshNames": ["Body", "Paint"],
  "type": "carPaint",
  "properties": {
    "baseColor": "#c90000",
    "metalness": 0.75,
    "roughness": 0.28,
    "clearcoat": 1.0,
    "clearcoatRoughness": 0.15,
    "envMapIntensity": 1.2
  },
  "variants": [
    { "id": "red", "label": "Red", "baseColor": "#c90000" },
    { "id": "black", "label": "Black", "baseColor": "#050505" },
    { "id": "white", "label": "White", "baseColor": "#eeeeee" }
  ]
}
```

## 19.2 Glass

```json
{
  "id": "glass_default",
  "target": "glass",
  "meshNames": ["Glass", "Windows"],
  "type": "glass",
  "properties": {
    "baseColor": "#9db7c9",
    "opacity": 0.45,
    "roughness": 0.05,
    "metalness": 0,
    "transmission": 0.4,
    "envMapIntensity": 1.4
  }
}
```

## 19.3 Rubber / tires

```json
{
  "id": "rubber_default",
  "target": "rubber",
  "meshNames": ["Tires"],
  "type": "rubber",
  "properties": {
    "baseColor": "#050505",
    "roughness": 0.82,
    "metalness": 0,
    "envMapIntensity": 0.1
  }
}
```

## 19.4 Emissive lights

```json
{
  "id": "headlight_material",
  "type": "emissiveLight",
  "states": {
    "off": {
      "baseColor": "#cccccc",
      "emissiveColor": "#000000",
      "emissiveIntensity": 0
    },
    "on": {
      "baseColor": "#fff4cc",
      "emissiveColor": "#fff4cc",
      "emissiveIntensity": 4.5
    }
  }
}
```

---

## 20. Scene, Environment, Lighting, Reflection, and Shadow Processing

## 20.1 Environment types

```txt
transparent
solid_color
gradient
image
hdri
studio
outdoor
night
showroom
```

## 20.2 Background rules

```txt
If background.type = transparent:
  renderer alpha = true
  scene.background = null

If background.type = solid_color:
  scene.background = color

If background.type = image:
  load image URL from ImgBB or configured provider
  render as CSS background or textured plane

If background.type = gradient:
  render CSS/canvas gradient behind transparent WebGL canvas
```

## 20.3 HDRI/environment rules

```txt
If environment.type = hdri:
  load HDR/HDRI from Supabase Storage
  convert to PMREM/environment map
  assign to scene.environment
  if visibleAsBackground = true:
    assign to scene.background
```

## 20.4 Reflection formula

For each material:

$$
envMapIntensity_{final} = envMapIntensity_{base} \cdot reflectionMultiplier_{part}
$$

Recommended multipliers:

```txt
body paint = 1.0
glass = 1.35
rubber tires = 0.1
chrome = 1.5
plastic = 0.4
```

## 20.5 Shadow rules

```txt
MVP:
  use contact shadows
  render once for static vehicles

High quality:
  enable directional shadow only if needed

Mobile:
  reduce resolution or disable shadows
```

---

## 21. Graphics Quality With Low GPU Usage

AutoZ should look premium but avoid unnecessary GPU load.

## 21.1 Default strategy

```txt
Use HDRI environment for reflections.
Use one key directional light.
Use contact shadows instead of full real-time shadow maps.
Use compressed textures where possible.
Use optimized GLB.
Use adaptive DPR.
Disable heavy post-processing on mobile.
Use demand-based rendering for static scenes.
Pause rendering when iframe is offscreen.
```

## 21.2 Quality presets

```json
{
  "low": {
    "dpr": [1, 1],
    "textureMax": 1024,
    "shadows": false,
    "contactShadowResolution": 256,
    "postProcessing": false,
    "environmentResolution": 512
  },
  "medium": {
    "dpr": [1, 1.25],
    "textureMax": 1024,
    "shadows": true,
    "contactShadowResolution": 512,
    "postProcessing": false,
    "environmentResolution": 1024
  },
  "high": {
    "dpr": [1, 1.75],
    "textureMax": 2048,
    "shadows": true,
    "contactShadowResolution": 1024,
    "postProcessing": true,
    "environmentResolution": 2048
  }
}
```

## 21.3 Adaptive quality formula

Let:

- $fps_{avg}$ = average FPS.
- $fps_{target}$ = target FPS.
- $q$ = quality factor from 0 to 1.

If FPS drops:

$$
q_{next} = \max(q_{min}, q_{current} - \delta)
$$

If FPS is stable above target:

$$
q_{next} = \min(q_{max}, q_{current} + \delta)
$$

DPR mapping:

$$
DPR = DPR_{min} + q(DPR_{max} - DPR_{min})
$$

Runtime rules:

```txt
fps_avg < 45 -> reduce DPR, disable bloom, lower shadows
fps_avg > 58 -> increase DPR gradually
mobile -> cap DPR at 1.25 by default
```

## 21.4 LOD formula

Projected screen height:

$$
h_{px} = \frac{H \cdot f}{z}
$$

Where:

$$
f = \frac{viewportHeight}{2\tan(FOV/2)}
$$

LOD rule:

```txt
if h_px > 700: high detail
if h_px > 300: medium detail
else: low detail
```

## 21.5 GPU budget targets

| Metric | MVP target |
|---|---:|
| Initial optimized GLB size | < 15 MB |
| Mobile optimized GLB size | < 8 MB |
| Texture max desktop | 2048 px |
| Texture max mobile | 1024 px |
| Triangles desktop | < 500k |
| Triangles mobile | < 250k |
| Draw calls | < 120 |
| iframe load time | < 2.5 sec |
| Viewer FPS desktop | 60 FPS |
| Viewer FPS mobile | 30-60 FPS |

---

## 22. Runtime Processing Algorithm

```txt
1. Read publishId from URL.
2. Fetch publish snapshot from Supabase.
3. Validate schemaVersion.
4. Load optimized model from Supabase Storage.
5. Load image preview/background from ImgBB if referenced.
6. Apply import.normalization transform.
7. Traverse scene and index meshes by name.
8. Apply material overrides.
9. Map configured parts to loaded meshes.
10. Build scene environment.
11. Build lighting.
12. Build reflections.
13. Build shadows.
14. Build camera and controls.
15. Register raycast click targets.
16. Build radial 3D UI.
17. Start render loop.
18. Apply interactions on user input.
19. Monitor performance and adapt quality.
20. Pause when iframe is offscreen.
```

## 22.1 TypeScript-style pseudocode

```ts
async function loadPublishedExperience(publishId: string) {
  const snapshot = await fetchPublishSnapshot(publishId);

  validateSnapshot(snapshot);

  const model = await loadGLB(snapshot.assets.model.url);

  applyNormalization(model.scene, snapshot.import.normalization);

  const meshIndex = indexMeshesByName(model.scene);

  applyMaterials(meshIndex, snapshot.materials);

  const parts = createParts(meshIndex, snapshot.parts);

  const scene = createScene(snapshot.scene);

  applyEnvironment(scene, snapshot.scene.environment);

  applyLighting(scene, snapshot.lighting);

  applyShadows(scene, snapshot.shadows);

  const camera = createCamera(snapshot.camera);

  const controls = createControls(snapshot.camera.controls);

  const interactions = createInteractionEngine({
    parts,
    interactions: snapshot.interactions,
    camera,
    controls
  });

  const ui = createRadialUI(snapshot.ui3d, parts, camera);

  startRenderer({
    scene,
    camera,
    rendererConfig: snapshot.renderer,
    performanceConfig: snapshot.performance,
    interactions,
    ui
  });
}
```

---

## 23. API Requirements

## 23.1 Save draft config

```txt
POST /api/projects/:projectId/config
```

Request:

```json
{
  "config": {}
}
```

Response:

```json
{
  "success": true,
  "version": 8
}
```

## 23.2 Upload image to ImgBB

```txt
POST /api/assets/image
```

Server behavior:

```txt
Receive image file
Upload to ImgBB using API key
Receive ImgBB JSON response
Save public URL and metadata into assets table
Return asset row
```

Response:

```json
{
  "assetId": "asset_123",
  "provider": "imgbb",
  "publicUrl": "https://i.ibb.co/example/car-thumbnail.webp"
}
```

## 23.3 Upload runtime asset to Supabase Storage

```txt
POST /api/assets/runtime
```

Server behavior:

```txt
Receive runtime file
Validate extension and size
Upload to Supabase Storage
Create asset row
Return public URL and storage path
```

## 23.4 Publish project

```txt
POST /api/projects/:projectId/publish
```

Response:

```json
{
  "publishId": "sedan-red-studio-82fa",
  "url": "https://autoz.app/view/sedan-red-studio-82fa",
  "version": 8,
  "iframe": "<iframe src=\"https://autoz.app/view/sedan-red-studio-82fa\" width=\"100%\" height=\"640\" frameborder=\"0\"></iframe>"
}
```

## 23.5 Fetch published config

```txt
GET /api/view/:publishId
```

Response:

```json
{
  "snapshot": {}
}
```

---

## 24. Publish System

## 24.1 Publish flow

```txt
User clicks Publish
   |
Validate draft config
   |
Ensure optimized model exists
   |
Ensure required parts have valid mesh names
   |
Ensure pivots and axes are valid
   |
Ensure image assets have ImgBB URLs
   |
Ensure runtime assets have Supabase Storage URLs
   |
Create immutable snapshot JSON
   |
Generate publishSlug
   |
Insert into publishes table
   |
Return direct URL and iframe code
```

## 24.2 iframe output

```html
<iframe
  src="https://autoz.app/view/sedan-red-studio-82fa"
  width="100%"
  height="640"
  frameborder="0"
  allow="fullscreen; xr-spatial-tracking"
></iframe>
```

## 24.3 Publish validation rules

Before publishing:

```txt
Model must exist.
Optimized model URL must exist.
Scene config must be valid.
Camera config must be valid.
Each part.meshNames must map to real meshes.
Each hinge part must have pivot and axis.
Each light interaction must map to target material/mesh.
Each image asset must have provider = imgbb or valid external image provider.
Each runtime asset must have provider = supabase_storage.
Performance config must exist.
```

---

## 25. MVP Scope

## 25.1 Must-have MVP

```txt
Project creation
Supabase auth/basic project ownership
GLB/GLTF upload
Supabase Storage runtime asset upload
ImgBB image upload for thumbnails/previews
Model normalization
Import report
Mesh selection
Manual part tagging
Pivot editing
Door hinge open/close
Bonnet open/close
Trunk open/close
Headlight toggle
Taillight toggle
Body color variants
Lighting config
HDRI/environment config
Reflection intensity config
Camera config
3D radial buttons
Performance presets
Save draft config
Publish immutable snapshot
/view/:publishId runtime viewer
Copy iframe button
```

## 25.2 Should-have MVP

```txt
Thumbnail generation
Mesh search/filter
Pivot presets
Transparent background mode
Studio lighting preset
Dark luxury preset
Mobile quality preset
Config JSON viewer
Publish preview card
```

## 25.3 Excluded from MVP

```txt
AI auto part detection
Auto pivot detection
Physics simulation
AR/VR
Multiplayer showroom
Real-time collaboration
CAD conversion
Vehicle telemetry
```

---

## 26. Future Roadmap

## Phase 2

```txt
AI part auto-detection
Auto pivot detection
Compound door animations
Sliding doors
Sunroof animation
Interior camera
Seat/material customization
Analytics dashboard
Variant comparison
```

## Phase 3

```txt
AR preview
WebXR showroom
Dealer lead forms
Multi-car comparison
Realtime collaborative editing
OEM API integrations
White-label domains
```

---

## 27. Acceptance Criteria

## 27.1 Import success

- User can upload a GLB.
- Model is stored in Supabase Storage.
- Model appears centered and grounded.
- Model is scaled to target viewport size.
- User can manually correct unit and forward direction.

## 27.2 Part interaction success

- User can tag a mesh as a door.
- User can set pivot and axis.
- Door opens smoothly using hinge rotation.
- User can tag headlight and toggle emissive state.
- User can change body color.
- Radial buttons appear near clicked part.

## 27.3 Scene config success

- User can set lighting preset.
- User can set HDRI environment.
- User can set reflection intensity.
- User can set camera FOV and orbit constraints.
- User can select transparent/image/solid background.

## 27.4 Storage success

- Images are uploaded to ImgBB and saved as asset rows.
- Runtime assets are uploaded to Supabase Storage and saved as asset rows.
- Publish snapshot references correct providers and URLs.

## 27.5 Publish success

- User can publish project.
- System creates immutable snapshot.
- `/view/:publishId` loads correct model and config.
- iframe renders the same experience outside AutoZ editor.

---

## 28. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Bad model structure | Hard to tag parts | Mesh list, import report, manual tagging |
| Merged meshes | Door/light cannot be separated | Warn user, allow submesh/material grouping where possible |
| Wrong unit/scale | Model too large/small | Unit picker, normalization preview |
| Wrong forward direction | Car faces wrong way | Front direction picker |
| Bad pivots | Door opens incorrectly | Pivot presets, gizmo, test button |
| Heavy textures | Slow loading/GPU issues | KTX2/WebP, resize, quality presets |
| Too many draw calls | Low FPS | Mesh merging, material batching, gltfpack |
| Expensive shadows | Mobile FPS drops | Contact shadows, adaptive quality |
| ImgBB image unavailability | Broken thumbnails/backgrounds | Store metadata, allow reupload, optionally cache critical previews |
| Public asset CORS | Runtime failures | Keep 3D runtime assets in Supabase Storage with controlled CORS |

---

## 29. Success Metrics

| Metric | Target |
|---|---:|
| Upload to preview | < 60 sec |
| Basic car setup time | < 10 min |
| Publish time | < 10 sec |
| iframe load time | < 2.5 sec |
| Desktop FPS | 60 FPS |
| Mobile FPS | 30-60 FPS |
| Config save success rate | > 99% |
| Publish reproducibility | 100% |
| Average draw calls | < 120 |
| Average optimized GLB size | < 15 MB |

---

## 30. Final Product Definition

AutoZ Engine is:

```txt
A Supabase-backed, config-driven, React Three Fiber + Three.js automotive 3D engine that normalizes uploaded car models, lets users define car parts and interactions, configures the full visual scene, stores image-like assets in ImgBB, stores runtime assets in Supabase Storage, and publishes the final experience as a stable iframe using /view/:publishId.
```

Final product promise:

> Any car model can become a clean, normalized, interactive, premium-looking 3D web experience without custom viewer engineering.

---

## 31. References

These are the primary official references used for technical direction:

- React Three Fiber documentation: <https://r3f.docs.pmnd.rs/getting-started/introduction>
- Three.js GLTFLoader documentation: <https://threejs.org/docs/pages/GLTFLoader.html>
- Three.js KTX2Loader documentation: <https://threejs.org/docs/pages/KTX2Loader.html>
- Three.js DRACOLoader documentation: <https://threejs.org/docs/pages/DRACOLoader.html>
- Supabase documentation: <https://supabase.com/docs/>
- ImgBB API documentation: <https://imgbb.com/api>
- glTF-Transform documentation: <https://gltf-transform.dev/>
- meshoptimizer / gltfpack documentation: <https://meshoptimizer.org/gltf/>
