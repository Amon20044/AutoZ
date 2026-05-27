/**
 * GET  /api/demo/config — returns the current landing demo snapshot (public).
 * POST /api/demo/config — overwrites public/demo/demo-config.json.
 *
 * Writes are LOCALHOST-only. The landing demo is a static asset committed to
 * the repo: developer edits locally → saves → git commits → push to Vercel.
 * Vercel serves the static JSON; /frame/demo fetches it client-side. Zero DB
 * involvement on either side.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { isLocalhostRequest } from '@/lib/demo-auth'
import { LOD_VARIANTS } from '@/lib/assets/lod-profiles'
import { isCompleteAssetManifest } from '@/lib/assets/lod-manifest'

export const runtime = 'nodejs'

const PUBLIC_DIR = path.join(process.cwd(), 'public')
const DEMO_DIR = path.join(PUBLIC_DIR, 'demo')
const DEMO_LOD_DIR = path.join(DEMO_DIR, 'lods')
const CONFIG_FILE = path.join(process.cwd(), 'public', 'demo', 'demo-config.json')
const DEFAULT_DEMO_MODEL_URL = '/Fortuner-compressed.glb'
const DEFAULT_DEMO_MODEL_NAME = 'Fortuner-compressed.glb'

async function writeConfig(config) {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true })
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8')
    if (!raw.trim()) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (err) {
    if (err?.code === 'ENOENT') return {}
    throw err
  }
}

function normalizeDemoConfig(config) {
  const safe = config && typeof config === 'object' && !Array.isArray(config) ? config : {}
  return {
    ...safe,
    model: {
      url: DEFAULT_DEMO_MODEL_URL,
      fileName: DEFAULT_DEMO_MODEL_NAME,
      path: DEFAULT_DEMO_MODEL_NAME,
      contentType: 'model/gltf-binary',
      ...(safe.model ?? {}),
    },
  }
}

function getPublicPathFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return path.join(PUBLIC_DIR, DEFAULT_DEMO_MODEL_NAME)
  if (/^https?:\/\//i.test(rawUrl)) {
    throw new Error('Demo model URL must be a local public/ URL.')
  }

  const cleanPath = decodeURIComponent(rawUrl.split(/[?#]/)[0] || DEFAULT_DEMO_MODEL_URL)
  const publicPath = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath
  const resolved = path.resolve(PUBLIC_DIR, publicPath)
  const relative = path.relative(PUBLIC_DIR, resolved)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Demo model URL must resolve inside public/.')
  }

  return resolved
}

async function fileExistsWithBytes(filePath, expectedBytes = 0) {
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return false
    if (expectedBytes > 0 && stat.size !== expectedBytes) return false
    return stat.size > 0
  } catch (err) {
    if (err?.code === 'ENOENT') return false
    throw err
  }
}

function getPublicFilePathFromLocalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || /^https?:\/\//i.test(rawUrl)) return null
  try {
    return getPublicPathFromUrl(rawUrl)
  } catch {
    return null
  }
}

async function localLodFilesExist(manifest) {
  if (!isCompleteAssetManifest(manifest)) return false

  for (const lod of manifest.lods ?? []) {
    const filePath = getPublicFilePathFromLocalUrl(lod.url)
    if (!filePath || !(await fileExistsWithBytes(filePath, Number(lod.bytes) || 0))) {
      return false
    }
  }

  const manifestPath = getPublicFilePathFromLocalUrl(manifest.manifestUrl)
  return manifestPath ? fileExistsWithBytes(manifestPath) : true
}

async function readLocalDemoManifest() {
  try {
    const raw = await fs.readFile(path.join(DEMO_LOD_DIR, 'manifest.json'), 'utf8')
    const manifest = JSON.parse(raw)
    return manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest : null
  } catch (err) {
    if (err?.code === 'ENOENT') return null
    return null
  }
}

export async function GET() {
  try {
    const config = await readConfig()
    const localManifest = config.assetManifest ? null : await readLocalDemoManifest()
    const assetManifest = config.assetManifest || (
      await localLodFilesExist(localManifest) ? localManifest : null
    )
    return NextResponse.json(
      { success: true, config: assetManifest ? { ...config, assetManifest } : config },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600' } },
    )
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  if (!isLocalhostRequest(request)) {
    return NextResponse.json({
      error: 'Demo config writes are localhost-only. Run the editor locally, commit public/demo/demo-config.json, and push to deploy.',
      code: 'LOCAL_ONLY',
    }, { status: 403 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const next = normalizeDemoConfig(body?.config)
  if (!next || typeof next !== 'object') {
    return NextResponse.json({ error: 'Missing config object.' }, { status: 400 })
  }
  if (!next.model?.url || typeof next.model.url !== 'string') {
    return NextResponse.json({ error: 'config.model.url is required.' }, { status: 400 })
  }

  try {
    const existingManifest = next.assetManifest
      ?? next.model?.assetManifest
      ?? next.assets?.assetManifest
      ?? await readLocalDemoManifest()
      ?? null
    const assetManifest = await localLodFilesExist(existingManifest) ? existingManifest : null
    const optimizationWarning = existingManifest && !assetManifest
      ? 'Device LOD manifest was present, but one or more public/demo/lods files are missing.'
      : null

    const merged = {
      ...next,
      assetManifest,
      publishedAt: new Date().toISOString(),
    }

    await writeConfig(merged)
    return NextResponse.json({
      success: true,
      config: merged,
      generated: {
        target: 'public/demo/lods',
        lods: LOD_VARIANTS.map((lod) => lod.id),
        stored: Boolean(assetManifest),
        skipped: !assetManifest,
        warning: optimizationWarning,
      },
      file: 'public/demo/demo-config.json',
      hint: 'git add public/demo/demo-config.json public/demo/lods && git commit -m "demo: update landing config" && git push',
    })
  } catch (err) {
    return NextResponse.json({
      error: `Could not persist demo config (${err.code || 'unknown'}). ${err.message || 'Check that public/demo/ is writable.'}`,
    }, { status: 500 })
  }
}
