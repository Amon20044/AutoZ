import { NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import prisma from '@/config/prisma'
import { s3Client, MODELS_BUCKET } from '@/config/s3'
import { normalizeAssetPath } from '@/lib/assets/manifest'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SIGNED_URL_EXPIRY_SECONDS = 3600
const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, immutable'
const CACHE_CONTROL_MANIFEST = 'no-cache'
const MAX_FILE_COUNT = 32
const MAX_FILE_SIZE_BYTES = 250 * 1024 * 1024

function getPublicStorageUrl(key) {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
  return `${supabaseUrl}/storage/v1/object/public/${MODELS_BUCKET}/${key}`
}

function validateFile(file) {
  if (!file || typeof file !== 'object') return 'Invalid file descriptor.'
  if (!file.key || typeof file.key !== 'string') return 'File key is required.'
  if (file.size && file.size > MAX_FILE_SIZE_BYTES) return `${file.key} exceeds the upload size limit.`
  if (file.contentType && typeof file.contentType !== 'string') return `${file.key} contentType must be a string.`
  return null
}

export async function POST(request) {
  try {
    if (!prisma) {
      return NextResponse.json({ error: 'Database is not configured.' }, { status: 500 })
    }

    const body = await request.json()
    const fileName = typeof body.fileName === 'string' && body.fileName.trim()
      ? body.fileName.trim()
      : 'model.glb'
    const files = Array.isArray(body.files) ? body.files : []

    if (files.length === 0 || files.length > MAX_FILE_COUNT) {
      return NextResponse.json({ error: `files must contain 1-${MAX_FILE_COUNT} entries.` }, { status: 400 })
    }

    for (const file of files) {
      const error = validateFile(file)
      if (error) return NextResponse.json({ error }, { status: 400 })
    }

    const project = await prisma.project.create({
      data: {
        name: fileName.replace(/\.[^.]+$/, '') || 'Optimized Asset',
        status: 'asset_uploading',
      },
      select: { id: true },
    })
    const assetId = project.id
    const uploadUrls = {}
    const publicUrls = {}
    const storageKeys = {}

    for (const file of files) {
      const safeKey = normalizeAssetPath(file.key)
      const objectKey = `assets/${assetId}/${safeKey}`
      const contentType = file.contentType || 'application/octet-stream'
      const cacheControl = safeKey === 'manifest.json' ? CACHE_CONTROL_MANIFEST : CACHE_CONTROL_IMMUTABLE
      const command = new PutObjectCommand({
        Bucket: MODELS_BUCKET,
        Key: objectKey,
        ContentType: contentType,
        CacheControl: cacheControl,
      })

      uploadUrls[safeKey] = await getSignedUrl(s3Client, command, {
        expiresIn: SIGNED_URL_EXPIRY_SECONDS,
      })
      publicUrls[safeKey] = getPublicStorageUrl(objectKey)
      storageKeys[safeKey] = objectKey
    }

    return NextResponse.json({
      assetId,
      uploadUrls,
      publicUrls,
      storageKeys,
      expiresIn: SIGNED_URL_EXPIRY_SECONDS,
    })
  } catch (err) {
    console.error('[Assets Init API] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
