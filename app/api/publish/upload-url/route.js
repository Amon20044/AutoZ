/**
 * POST /api/publish/upload-url
 *
 * Generate a presigned S3 upload URL so the client can upload large model
 * files directly to Supabase Storage, bypassing Next.js API memory limits.
 *
 * Body (JSON):
 *   { slug, fileName, contentType? }
 *
 * Response:
 *   { uploadUrl, publicUrl, key, method }
 */
import { NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3Client, MODELS_BUCKET } from '@/config/s3'

export const dynamic = 'force-dynamic'

const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, immutable'
const SIGNED_URL_EXPIRY_SECONDS = 3600 // 1 hour

function getPublicStorageUrl(key) {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
  return `${supabaseUrl}/storage/v1/object/public/${MODELS_BUCKET}/${key}`
}

function sanitizeStoragePath(value) {
  const raw = String(value ?? '').replace(/\\/g, '/')
  const safeParts = raw
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => part.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'asset')

  return safeParts.join('/') || 'asset'
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { slug, fileName, contentType } = body

    if (!slug || !fileName) {
      return NextResponse.json(
        { error: 'Missing required fields: slug, fileName' },
        { status: 400 },
      )
    }

    const safePath = sanitizeStoragePath(fileName)
    const key = `models/${slug}/${safePath}`
    const mime = contentType || guessMime(safePath)

    // Create a presigned PUT URL for direct client upload
    const command = new PutObjectCommand({
      Bucket: MODELS_BUCKET,
      Key: key,
      ContentType: mime,
      CacheControl: CACHE_CONTROL_IMMUTABLE,
    })

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: SIGNED_URL_EXPIRY_SECONDS,
    })

    return NextResponse.json({
      uploadUrl,
      publicUrl: getPublicStorageUrl(key),
      key,
      path: safePath,
      method: 'PUT',
      expiresIn: SIGNED_URL_EXPIRY_SECONDS,
    })
  } catch (err) {
    console.error('[Upload URL API] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function guessMime(path) {
  const ext = path.split('.').pop()?.toLowerCase()
  const types = {
    bin: 'application/octet-stream',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    hdr: 'image/vnd.radiance',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    ktx2: 'image/ktx2',
    png: 'image/png',
    webp: 'image/webp',
  }
  return types[ext] || 'application/octet-stream'
}
