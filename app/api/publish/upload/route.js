/**
 * POST /api/publish/upload
 *
 * Chunked model upload proxy for large GLB files.
 *
 * The browser sends one Vercel-safe 4 MB binary request per file slice. Each
 * slice is stored as a separate object under models/{slug}/{uploadId}/{fileName}.part-000,
 * then the browser calls this route once more with mode=manifest to write
 * models/{slug}/{uploadId}/manifest.json.
 *
 * Three.js cannot load the split parts directly; the frame/editor client fetches
 * the manifest, downloads the parts, rebuilds one Blob, and loads that blob URL.
 */

import { NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { s3Client, MODELS_BUCKET } from '@/config/s3'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CHUNK_SIZE = 4 * 1024 * 1024
const CACHE_CONTROL_CHUNK = 'no-cache'
const CACHE_CONTROL_MANIFEST = 'no-cache'

function getPublicStorageUrl(key) {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
  return `${base}/storage/v1/object/public/${MODELS_BUCKET}/${key}`
}

function sanitizePath(raw) {
  return String(raw ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .map((p) => p.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'asset')
    .join('/') || 'model.glb'
}

function guessMime(path, hint) {
  if (hint && hint !== 'application/octet-stream') return hint
  const ext = (path ?? '').split('.').pop()?.toLowerCase()
  return (
    { glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream' }[ext]
    || 'model/gltf-binary'
  )
}

function getPartName(safePath, partIndex) {
  return `${safePath}.part-${String(partIndex).padStart(3, '0')}`
}

async function readRequestBuffer(request, maxBytes) {
  if (!request.body) return Buffer.alloc(0)

  const reader = request.body.getReader()
  const chunks = []
  let total = 0

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    total += value.byteLength
    if (total > maxBytes) {
      throw new Error(`Chunk exceeded ${(maxBytes / 1024 / 1024).toFixed(0)} MB upload limit.`)
    }

    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
  }

  return Buffer.concat(chunks, total)
}

function parseIntegerParam(url, name, fallback = null) {
  const raw = url.searchParams.get(name)
  if (raw == null || raw === '') return fallback

  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : fallback
}

function buildManifest({ safePath, contentType, fileSize, totalParts }) {
  return {
    version: 1,
    kind: 'autoz-chunked-model',
    fileName: safePath.split('/').pop() || safePath,
    path: safePath,
    contentType,
    size: fileSize,
    chunkSize: CHUNK_SIZE,
    chunks: Array.from({ length: totalParts }, (_, index) => getPartName(safePath, index)),
  }
}

async function uploadObject({ key, body, contentType, cacheControl }) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: MODELS_BUCKET,
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  )
}

export async function POST(request) {
  try {
    const url = new URL(request.url)
    const mode = url.searchParams.get('mode') || 'part'
    const slug = url.searchParams.get('slug')
    const uploadId = sanitizePath(url.searchParams.get('uploadId') || `upload-${Date.now()}`)
    const fileName = url.searchParams.get('fileName') || 'model.glb'
    const fileSize = parseIntegerParam(url, 'fileSize', 0)
    const contentTypeHint = url.searchParams.get('contentType') || ''
    const totalParts = parseIntegerParam(url, 'totalParts', 0)

    if (!slug) {
      return NextResponse.json({ error: 'Missing required query param: slug' }, { status: 400 })
    }

    const safePath = sanitizePath(fileName)
    const contentType = guessMime(safePath, contentTypeHint)

    if (mode === 'manifest') {
      if (!totalParts || totalParts < 1) {
        return NextResponse.json({ error: 'Missing or invalid totalParts for manifest upload.' }, { status: 400 })
      }

      const manifest = buildManifest({ safePath, contentType, fileSize, totalParts })
      const body = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
      const key = `models/${slug}/${uploadId}/manifest.json`

      await uploadObject({
        key,
        body,
        contentType: 'application/json',
        cacheControl: CACHE_CONTROL_MANIFEST,
      })

      const publicUrl = getPublicStorageUrl(key)
      console.log(`[Upload] manifest ${key} (${totalParts} parts) -> ${publicUrl}`)

      return NextResponse.json({
        publicUrl,
        key,
        path: 'manifest.json',
        chunked: true,
        manifest,
        size: fileSize,
        fileName: manifest.fileName,
        contentType,
      })
    }

    const partIndex = parseIntegerParam(url, 'partIndex', null)

    if (partIndex == null || partIndex < 0) {
      return NextResponse.json({ error: 'Missing or invalid partIndex.' }, { status: 400 })
    }

    if (!totalParts || partIndex >= totalParts) {
      return NextResponse.json({ error: 'Missing or invalid totalParts.' }, { status: 400 })
    }

    const body = await readRequestBuffer(request, CHUNK_SIZE)
    if (body.length === 0) {
      return NextResponse.json({ error: 'Chunk body is empty.' }, { status: 400 })
    }

    const partName = getPartName(safePath, partIndex)
    const key = `models/${slug}/${uploadId}/${partName}`

    await uploadObject({
      key,
      body,
      contentType: 'application/octet-stream',
      cacheControl: CACHE_CONTROL_CHUNK,
    })

    console.log(`[Upload] part ${partIndex + 1}/${totalParts} ${key} (${(body.length / 1024 / 1024).toFixed(1)} MB)`)

    return NextResponse.json({
      key,
      path: partName,
      publicUrl: getPublicStorageUrl(key),
      partIndex,
      totalParts,
      size: body.length,
    })
  } catch (err) {
    console.error('[Upload API] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
