import { promises as fs } from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { isLocalhostRequest } from '@/lib/demo-auth'
import { LOD_VARIANTS } from '@/lib/assets/lod-profiles'

export const runtime = 'nodejs'

const DEMO_DIR = path.join(process.cwd(), 'public', 'demo')
const DEMO_LOD_DIR = path.join(DEMO_DIR, 'lods')
const ALLOWED_FILE_KEYS = new Set([
  'manifest.json',
  ...LOD_VARIANTS.map((lod) => lod.key),
])

function getDemoOutputPath(fileKey) {
  if (!ALLOWED_FILE_KEYS.has(fileKey)) {
    throw new Error(`Unsupported demo asset key: ${fileKey}`)
  }

  if (fileKey === 'manifest.json') return path.join(DEMO_LOD_DIR, 'manifest.json')

  const resolved = path.resolve(DEMO_DIR, fileKey)
  const relative = path.relative(DEMO_DIR, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe demo asset path: ${fileKey}`)
  }
  return resolved
}

function getDemoPublicUrl(fileKey) {
  return fileKey === 'manifest.json'
    ? '/demo/lods/manifest.json'
    : `/demo/${fileKey}`
}

export async function POST(request) {
  if (!isLocalhostRequest(request)) {
    return NextResponse.json({
      error: 'Demo asset writes are localhost-only.',
      code: 'LOCAL_ONLY',
    }, { status: 403 })
  }

  try {
    const formData = await request.formData()
    const fileKey = formData.get('fileKey')
    const file = formData.get('file')

    if (typeof fileKey !== 'string' || !fileKey) {
      return NextResponse.json({ error: 'fileKey is required.' }, { status: 400 })
    }
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'file is required.' }, { status: 400 })
    }

    const outputPath = getDemoOutputPath(fileKey)
    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.byteLength <= 0) {
      return NextResponse.json({ error: 'file is empty.' }, { status: 400 })
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, bytes)

    return NextResponse.json({
      success: true,
      fileKey,
      bytes: bytes.byteLength,
      publicUrl: getDemoPublicUrl(fileKey),
    })
  } catch (err) {
    console.error('[Demo Assets API] Error:', err)
    return NextResponse.json({
      error: err.message || 'Could not write demo asset.',
    }, { status: 500 })
  }
}
