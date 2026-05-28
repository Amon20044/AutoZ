/**
 * Regenerate the landing-demo LOD ladder with GENUINE reduction.
 *
 * The previous /public/demo/lods/*.glb were byte-identical copies of the 29 MB
 * source (the silent "source copy" fallback when the browser optimizer threw),
 * so the ladder downloaded the full model for every rung. This script rebuilds
 * each rung for real using gltf-transform: geometry `simplify` (per-LOD ratio)
 * + `meshopt` compression (the source has neither) + a light texture pass.
 *
 * The 285 meshes are kept SEPARATE (no join/flatten) so the runtime's part
 * detection still finds doors/wheels/lights on every rung. `lockBorder` keeps
 * adjacent panels from cracking apart when decimated.
 *
 * Run: node scripts/generate-demo-lods.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import {
  dedup, prune, weld, simplify, quantize, resample, textureCompress, TextureResizeFilter, meshopt,
} from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { LOD_VARIANTS } from '../src/lib/assets/lod-profiles.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SOURCE = resolve(ROOT, 'public/Fortuner-compressed.glb')
const LODS_DIR = resolve(ROOT, 'public/demo/lods')
const DEMO_CONFIG = resolve(ROOT, 'public/demo/demo-config.json')
const DEMO_MANIFEST = resolve(LODS_DIR, 'manifest.json')

function countTriangles(doc) {
  let triangles = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue
      const indices = prim.getIndices()
      const position = prim.getAttribute('POSITION')
      triangles += indices
        ? Math.floor(indices.getCount() / 3)
        : Math.floor((position?.getCount() || 0) / 3)
    }
  }
  return triangles
}

// Looser geometry error budget for the aggressive low rungs so `simplify`
// actually reaches the target ratio; tight for the near-full high rungs.
function errorFor(ratio) {
  return Math.min(0.02, Math.max(0.0009, 0.0009 / ratio))
}

async function buildLod(io, sourceBytes, lod) {
  const doc = await io.readBinary(sourceBytes)

  await doc.transform(
    dedup(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: lod.triangleRatio, error: errorFor(lod.triangleRatio), lockBorder: true }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8 }),
    resample(),
    prune(),
  )

  // Texture pass is a minor win on this model (~0.6 MB of textures) and must
  // never sink the whole LOD — geometry is the real lever, so swallow failures.
  let textureFormat = 'source'
  try {
    await doc.transform(textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [lod.maxTextureSize, lod.maxTextureSize],
      resizeFilter: TextureResizeFilter.LANCZOS3,
      quality: lod.maxTextureSize <= 512 ? 72 : 82,
    }))
    textureFormat = 'webp'
  } catch (err) {
    console.warn(`  texture pass skipped for ${lod.id}: ${err.message}`)
  }

  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }))

  const triangles = countTriangles(doc)
  const out = await io.writeBinary(doc)
  const outPath = resolve(LODS_DIR, `lod-${lod.id}.glb`)
  writeFileSync(outPath, out)
  return { bytes: out.byteLength, triangles, textureFormat }
}

async function main() {
  await MeshoptEncoder.ready
  await MeshoptDecoder.ready
  await MeshoptSimplifier.ready

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
      'meshopt.decoder': MeshoptDecoder,
    })

  const sourceBytes = new Uint8Array(readFileSync(SOURCE))
  const originalBytes = sourceBytes.byteLength
  const baseDoc = await io.readBinary(sourceBytes)
  const originalTriangles = countTriangles(baseDoc)
  console.log(`Source: ${(originalBytes / 1048576).toFixed(1)} MB, ${originalTriangles.toLocaleString()} triangles\n`)

  const results = {}
  for (const lod of LOD_VARIANTS) {
    process.stdout.write(`Building ${lod.id} (ratio ${lod.triangleRatio})... `)
    const r = await buildLod(io, sourceBytes, lod)
    results[lod.id] = r
    console.log(`${(r.bytes / 1048576).toFixed(2)} MB, ${r.triangles.toLocaleString()} tris`)
  }

  // ── Patch demo-config.json assetManifest with real numbers ──
  const config = JSON.parse(readFileSync(DEMO_CONFIG, 'utf8'))
  const am = config.assetManifest
  if (am) {
    am.compression = { geometry: 'meshopt', textures: 'webp', textureFallback: 'webp' }
    for (const lod of am.lods ?? []) {
      const r = results[lod.id]
      if (!r) continue
      lod.bytes = r.bytes
      lod.triangles = r.triangles
      lod.textureFormat = r.textureFormat
    }
    am.stats = am.stats || {}
    am.stats.originalTriangles = originalTriangles
    am.stats.lods = Object.fromEntries(
      Object.entries(results).map(([id, r]) => [id, { triangles: r.triangles, bytes: r.bytes, textureFormat: r.textureFormat }]),
    )
    writeFileSync(DEMO_CONFIG, `${JSON.stringify(config, null, 2)}\n`)
    console.log('\nPatched public/demo/demo-config.json')
  }

  // ── Mirror into the standalone manifest.json (same shape) ──
  try {
    const manifest = JSON.parse(readFileSync(DEMO_MANIFEST, 'utf8'))
    manifest.compression = { geometry: 'meshopt', textures: 'webp', textureFallback: 'webp' }
    for (const lod of manifest.lods ?? []) {
      const r = results[lod.id]
      if (!r) continue
      lod.bytes = r.bytes
      lod.triangles = r.triangles
      lod.textureFormat = r.textureFormat
    }
    if (manifest.stats) {
      manifest.stats.originalTriangles = originalTriangles
      manifest.stats.lods = Object.fromEntries(
        Object.entries(results).map(([id, r]) => [id, { triangles: r.triangles, bytes: r.bytes, textureFormat: r.textureFormat }]),
      )
    }
    writeFileSync(DEMO_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log('Patched public/demo/lods/manifest.json')
  } catch (err) {
    console.warn(`Could not patch manifest.json: ${err.message}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
