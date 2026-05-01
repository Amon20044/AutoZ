/**
 * POST /api/publish
 *
 * Full publish pipeline:
 *   1. Receive model file + config JSON from editor
 *   2. Upload .glb model to Supabase S3
 *   3. Process textures → optimized WebP → upload to ImgBB
 *   4. Build snapshot JSON (3D config + asset URLs)
 *   5. Create Project + Assets + Publish rows in DB
 *   6. Return publish slug for iframe embed
 */
import { NextResponse } from 'next/server'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { s3Client, MODELS_BUCKET } from '@/config/s3'
import { uploadBufferToImgBB } from '@/config/imgbb'
import prisma from '@/config/prisma'
import { normalizePublishId, resolvePublishId } from '@/lib/publish-ids'

const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, immutable'
const MULTIPART_THRESHOLD_BYTES = 6 * 1024 * 1024
const MULTIPART_MIN_PART_BYTES = 8 * 1024 * 1024
const MULTIPART_MAX_PARTS = 10000
const MULTIPART_CONCURRENCY = 3

/**
 * Build the public download URL for a Supabase Storage object.
 * S3_URL is the S3-compatible endpoint (for AWS SDK uploads) and must NOT be
 * used for public URLs. Public URLs use the Supabase REST format:
 *   {SUPABASE_URL}/storage/v1/object/public/{bucket}/{key}
 */
function getPublicStorageUrl(key) {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
  return `${supabaseUrl}/storage/v1/object/public/${MODELS_BUCKET}/${key}`
}

export async function POST(request) {
  try {
    if (!prisma) {
      return NextResponse.json({ error: 'Database is not configured on this deployment.' }, { status: 500 })
    }

    const formData = await request.formData()

    // ─── Extract fields ───────────────────────────────────────────────
    const modelFile = formData.get('model')       // File: .glb
    const configJson = formData.get('config')     // string: JSON
    const projectNameValue = formData.get('name')
    const projectName = typeof projectNameValue === 'string' && projectNameValue.trim()
      ? projectNameValue.trim()
      : 'Untitled Project'
    const thumbnailFile = formData.get('thumbnail') // File: screenshot (optional)
    const requestedPublishIdValue = formData.get('publishId')
    const requestedPublishId = typeof requestedPublishIdValue === 'string' ? requestedPublishIdValue : null
    const updateExistingPublish = formData.get('updateExisting') === 'true'
    const modelPathValue = formData.get('modelPath')
    const modelPath = sanitizeStoragePath(
      typeof modelPathValue === 'string' ? modelPathValue : modelFile?.name || 'model.glb',
    )
    const resourceFiles = formData.getAll('resources').filter(isUploadedFile)
    const resourcePaths = parseResourcePaths(formData.get('resourcePaths'))

    if (!isUploadedFile(modelFile)) {
      return NextResponse.json({ error: 'No model file provided' }, { status: 400 })
    }

    const config = typeof configJson === 'string' && configJson ? JSON.parse(configJson) : {}
    const existingPublish = updateExistingPublish && requestedPublishId
      ? await prisma.publish.findUnique({
        where: { publishSlug: normalizePublishId(requestedPublishId) || requestedPublishId },
        select: { id: true, projectId: true, publishSlug: true, version: true },
      })
      : null
    const resolvedPublish = existingPublish
      ? { publishId: existingPublish.publishSlug, changed: false }
      : await resolvePublishId(prisma, requestedPublishId)
    const slug = resolvedPublish.publishId
    const publishIdChanged = resolvedPublish.changed

    // ─── 1. Upload model to Supabase S3 ────────────────────────────────
    const modelBuffer = Buffer.from(await modelFile.arrayBuffer())
    const modelKey = `models/${slug}/${modelPath}`

    await uploadBufferToS3Object({
      key: modelKey,
      body: modelBuffer,
      contentType: getContentType(modelFile, modelPath),
    })

    const modelUrl = getPublicStorageUrl(modelKey)

    const runtimeAssets = []
    for (let i = 0; i < resourceFiles.length; i++) {
      const resourceFile = resourceFiles[i]
      const resourcePath = sanitizeStoragePath(resourcePaths[i] || resourceFile.name)
      if (!resourcePath || resourcePath === modelPath) continue

      const resourceBuffer = Buffer.from(await resourceFile.arrayBuffer())
      const resourceKey = `models/${slug}/${resourcePath}`
      const resourceContentType = getContentType(resourceFile, resourcePath)

      await uploadBufferToS3Object({
        key: resourceKey,
        body: resourceBuffer,
        contentType: resourceContentType,
      })

      runtimeAssets.push({
        originalName: resourceFile.name,
        path: resourcePath,
        key: resourceKey,
        url: getPublicStorageUrl(resourceKey),
        size: resourceFile.size,
        contentType: resourceContentType,
      })
    }

    // ─── 2. Process thumbnail → WebP → ImgBB ──────────────────────────
    let thumbnailResult = null
    if (isUploadedFile(thumbnailFile)) {
      const thumbBuffer = Buffer.from(await thumbnailFile.arrayBuffer())
      const webpBuffer = await sharp(thumbBuffer)
        .resize({ width: 800, height: 600, fit: 'cover' })
        .webp({ quality: 85 })
        .toBuffer()

      thumbnailResult = await uploadBufferToImgBB(webpBuffer, {
        name: `${slug}_thumb`,
      })
    }

    // ─── 3. Process texture screenshots if provided ─────────────────────
    const textureAssets = []
    const textureFiles = formData.getAll('textures') // File[]
    for (const texFile of textureFiles) {
      if (!texFile || typeof texFile === 'string') continue
      try {
        const texBuffer = Buffer.from(await texFile.arrayBuffer())
        const webpBuffer = await sharp(texBuffer)
          .webp({ quality: 80 })
          .toBuffer()
        const imgResult = await uploadBufferToImgBB(webpBuffer, {
          name: `${slug}_${texFile.name.replace(/\.[^.]+$/, '')}`,
        })
        textureAssets.push({
          originalName: texFile.name,
          url: imgResult.url,
          thumbUrl: imgResult.thumbUrl,
          width: imgResult.width,
          height: imgResult.height,
        })
      } catch (err) {
        console.warn(`[Publish] Failed to process texture ${texFile.name}:`, err.message)
      }
    }

    // ─── 4. Build snapshot ─────────────────────────────────────────────
    const snapshot = {
      version: 1,
      slug,
      model: {
        url: modelUrl,
        fileName: modelFile.name,
        path: modelPath,
        fileSize: modelFile.size,
      },
      runtimeAssets,
      thumbnail: thumbnailResult ? {
        url: thumbnailResult.url,
        thumbUrl: thumbnailResult.thumbUrl,
      } : null,
      textureAssets,
      // 3D configuration from editor
      import: config.import || {},
      parts: config.parts || [],
      materials: config.materials || [],
      lighting: config.lighting || {
        intensity: 1,
        ambient: { enabled: true, color: '#ffffff', intensity: 0.35 },
        lights: [
          { type: 'directional', position: [4, 6, -4], intensity: 2.2, color: '#ffffff', castShadow: true },
          { type: 'directional', position: [-4, 3, 3], intensity: 0.8, color: '#dbeafe' },
          { type: 'directional', position: [0, 4, 6], intensity: 1.1, color: '#ffffff' },
        ],
      },
      environment: config.environment || { preset: 'studio', background: false },
      camera: config.camera || { fov: 40, autoFit: true, position: [5, 3, -7] },
      platform: config.platform || {
        enabled: true,
        radius: 3,
        color: '#e0e0e0',
        metalness: 0.92,
        roughness: 0.04,
        autoRotate: true,
        rotateSpeed: 0.12,
      },
      fog: config.fog || { enabled: false, color: '#0a0a0f', near: 10, far: 50 },
      postprocessing: config.postprocessing || {
        enabled: true,
        glare: 0.18,
        grain: 0.04,
        vignette: 0.2,
        exposure: 1.1,
        contrast: 1,
        saturation: 1,
      },
      performance: config.performance || { preset: 'high' },
      branding: { watermark: true, text: 'made in AutoZ' },
      publishedAt: new Date().toISOString(),
    }

    // ─── 5. Save to database ──────────────────────────────────────────
    const nextVersion = existingPublish ? existingPublish.version + 1 : 1
    const assetCreates = [
      {
        assetType: 'model',
        storageProvider: 'supabase_s3',
        publicUrl: modelUrl,
        storagePath: modelKey,
        mimeType: getContentType(modelFile, modelPath),
        fileName: modelFile.name,
        fileSizeBytes: BigInt(modelFile.size),
        metadata: {},
      },
      ...(thumbnailResult ? [{
        assetType: 'thumbnail',
        storageProvider: 'imgbb',
        publicUrl: thumbnailResult.url,
        mimeType: 'image/webp',
        fileName: `${slug}_thumb.webp`,
        width: thumbnailResult.width,
        height: thumbnailResult.height,
        metadata: { deleteUrl: thumbnailResult.deleteUrl },
      }] : []),
      ...runtimeAssets.map((asset) => ({
        assetType: 'runtime_resource',
        storageProvider: 'supabase_s3',
        publicUrl: asset.url,
        storagePath: asset.key,
        mimeType: asset.contentType,
        fileName: asset.path,
        fileSizeBytes: BigInt(asset.size),
        metadata: { originalName: asset.originalName },
      })),
      ...textureAssets.map((t) => ({
        assetType: 'texture',
        storageProvider: 'imgbb',
        publicUrl: t.url,
        mimeType: 'image/webp',
        fileName: t.originalName,
        width: t.width,
        height: t.height,
        metadata: {},
      })),
    ]

    const project = existingPublish
      ? await prisma.project.update({
        where: { id: existingPublish.projectId },
        data: {
          name: projectName,
          status: 'published',
          assets: { create: assetCreates },
          configs: {
            create: {
              config: config,
              version: nextVersion,
            },
          },
          publishes: {
            update: {
              where: { id: existingPublish.id },
              data: {
                snapshot: snapshot,
                version: nextVersion,
                isPublic: true,
              },
            },
          },
        },
        include: { publishes: true },
      })
      : await prisma.project.create({
        data: {
          name: projectName,
          status: 'published',
          assets: { create: assetCreates },
          configs: {
            create: {
              config: config,
              version: nextVersion,
            },
          },
          publishes: {
            create: {
              publishSlug: slug,
              snapshot: snapshot,
              version: nextVersion,
              isPublic: true,
            },
          },
        },
        include: { publishes: true },
      })

    // Prefer an explicit public base URL from env for hosted deployments,
    // otherwise fall back to request-derived base URL.
    const publicBase = process.env.NEXT_PUBLIC_BASE_URL || getBaseUrl(request)
    const absFrame = `${publicBase}/frame/${slug}`
    const absEditor = `${publicBase}/editor/${slug}`

    return NextResponse.json({
      success: true,
      projectId: project.id,
      slug,
      requestedPublishId: requestedPublishId || null,
      publishIdChanged,
      // Return absolute frame URL so clients and external sites can use it
      frameUrl: absFrame,
      editorUrl: absEditor,
      embedCode: `<iframe src="${absFrame}" width="100%" height="600" frameborder="0" allowfullscreen></iframe>`,
    })

  } catch (err) {
    console.error('[Publish API] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBaseUrl(request) {
  const host = request.headers.get('host') || 'localhost:3000'
  const proto = request.headers.get('x-forwarded-proto') || 'http'
  return `${proto}://${host}`
}

async function uploadBufferToS3Object({ key, body, contentType }) {
  if (body.length < MULTIPART_THRESHOLD_BYTES) {
    await s3Client.send(new PutObjectCommand({
      Bucket: MODELS_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: CACHE_CONTROL_IMMUTABLE,
    }))
    return
  }

  await multipartUploadBuffer({ key, body, contentType })
}

async function multipartUploadBuffer({ key, body, contentType }) {
  const partSize = getMultipartPartSize(body.length)
  const partCount = Math.ceil(body.length / partSize)
  const createResult = await s3Client.send(new CreateMultipartUploadCommand({
    Bucket: MODELS_BUCKET,
    Key: key,
    ContentType: contentType,
    CacheControl: CACHE_CONTROL_IMMUTABLE,
  }))
  const uploadId = createResult.UploadId

  if (!uploadId) throw new Error('Storage did not return a multipart upload id.')

  try {
    const parts = new Array(partCount)
    let nextPartIndex = 0

    const uploadNextPart = async () => {
      while (nextPartIndex < partCount) {
        const partIndex = nextPartIndex
        nextPartIndex += 1

        const partNumber = partIndex + 1
        const start = partIndex * partSize
        const end = Math.min(start + partSize, body.length)
        const uploadPartResult = await s3Client.send(new UploadPartCommand({
          Bucket: MODELS_BUCKET,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body.subarray(start, end),
        }))

        if (!uploadPartResult.ETag) {
          throw new Error(`Storage did not return an ETag for part ${partNumber}.`)
        }

        parts[partIndex] = {
          ETag: uploadPartResult.ETag,
          PartNumber: partNumber,
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(MULTIPART_CONCURRENCY, partCount) }, () => uploadNextPart()),
    )

    await s3Client.send(new CompleteMultipartUploadCommand({
      Bucket: MODELS_BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }))
  } catch (err) {
    await abortMultipartUpload({ key, uploadId })
    throw normalizeStorageUploadError(err)
  }
}

function getMultipartPartSize(totalBytes) {
  return Math.max(MULTIPART_MIN_PART_BYTES, Math.ceil(totalBytes / MULTIPART_MAX_PARTS))
}

async function abortMultipartUpload({ key, uploadId }) {
  try {
    await s3Client.send(new AbortMultipartUploadCommand({
      Bucket: MODELS_BUCKET,
      Key: key,
      UploadId: uploadId,
    }))
  } catch (abortError) {
    console.warn('[Publish API] Failed to abort multipart upload:', abortError.message)
  }
}

function normalizeStorageUploadError(err) {
  if (err?.Code === 'EntityTooLarge' || err?.name === 'EntityTooLarge') {
    return new Error(
      'The model is larger than the current Supabase Storage bucket/global file limit. Multipart upload is enabled, but the Storage size limit still needs to allow this file.',
    )
  }

  return err
}

function isUploadedFile(value) {
  return value && typeof value !== 'string' && typeof value.arrayBuffer === 'function'
}

function parseResourcePaths(value) {
  if (!value || typeof value !== 'string') return []

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
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

function getContentType(file, path) {
  if (file.type) return file.type

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
