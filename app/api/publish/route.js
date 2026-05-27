/**
 * POST /api/publish
 *
 * Full publish pipeline — supports two model upload strategies:
 *
 * A) **Direct upload** (small files):
 *    Client sends model as a FormData `model` File field.
 *    The API uploads it to Supabase S3 server-side.
 *
 * B) **Chunked manifest upload** (large files):
 *    Client uploads 3 MB objects through POST /api/publish/upload, then calls
 *    this endpoint with `modelUrl` + `modelKey` + `modelFileName` +
 *    `modelFileSize` + chunk manifest metadata instead of a model File.
 *
 * Pipeline:
 *   1. Receive config JSON (+ model file OR model metadata)
 *   2. Upload .glb model to S3 if provided as file
 *   3. Upload resource files to S3
 *   4. Process textures → WebP → ImgBB
 *   5. Build complete snapshot JSON (full 3D config + asset URLs)
 *   6. Create/update Project + Assets + Publish rows in DB
 *   7. Return publish slug + frame URL + embed code
 */
import { NextResponse } from 'next/server'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { s3Client, MODELS_BUCKET } from '@/config/s3'
import { uploadBufferToImgBB } from '@/config/imgbb'
import prisma from '@/config/prisma'
import { normalizePublishId, resolvePublishId } from '@/lib/publish-ids'
import { getPlatformTestKey, verifyTestKey } from '@/lib/demo-auth'

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

    // Tester key gate — only enforced when PLATFORM_TEST_KEY is configured.
    // This lets dev/preview deployments publish without a key while keeping
    // prod locked behind a tester-provisioned credential.
    if (getPlatformTestKey()) {
      const result = verifyTestKey(request.headers.get('x-test-key'))
      if (!result.ok) {
        return NextResponse.json({ error: result.reason, code: 'TEST_KEY_REQUIRED' }, { status: 401 })
      }
    }

    const formData = await request.formData()

    // ─── Extract fields ───────────────────────────────────────────────
    const modelFile = formData.get('model')       // File: .glb (may be null for presigned uploads)
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
    const uploadId = sanitizeStoragePath(formData.get('uploadId') || `upload-${Date.now()}`)
    const modelOptimization = parseJsonObject(formData.get('modelOptimization'))

    // Pre-upload fields (set when the model was uploaded before publish finalization)
    const preUploadedModelUrl = formData.get('modelUrl')
    const preUploadedModelKey = formData.get('modelKey')
    const preUploadedModelFileName = formData.get('modelFileName')
    const preUploadedModelFileSize = formData.get('modelFileSize')
    const preUploadedModelIsChunked = formData.get('modelIsChunked') === 'true'
    const preUploadedModelManifest = parseJsonObject(formData.get('modelManifest'))

    const hasPreUploadedModel = typeof preUploadedModelUrl === 'string' && preUploadedModelUrl
    const hasDirectModel = isUploadedFile(modelFile)

    if (!hasPreUploadedModel && !hasDirectModel) {
      return NextResponse.json({ error: 'No model provided. Send either a model file or modelUrl/modelKey from presigned upload.' }, { status: 400 })
    }

    const resourceFiles = formData.getAll('resources').filter(isUploadedFile)
    const resourcePaths = parseResourcePaths(formData.get('resourcePaths'))

    const config = typeof configJson === 'string' && configJson ? JSON.parse(configJson) : {}
    const existingPublish = updateExistingPublish && requestedPublishId
      ? await prisma.publish.findUnique({
        where: { publishSlug: normalizePublishId(requestedPublishId) || requestedPublishId },
        select: { id: true, projectId: true, publishSlug: true, version: true, snapshot: true },
      })
      : null
    const resolvedPublish = existingPublish
      ? { publishId: existingPublish.publishSlug, changed: false }
      : await resolvePublishId(prisma, requestedPublishId)
    const slug = resolvedPublish.publishId
    const publishIdChanged = resolvedPublish.changed

    // ─── 1. Resolve model URL + key ──────────────────────────────────
    let modelUrl, modelKey, modelFileName, modelFileSize, modelMimeType, modelChunked, modelManifest

    if (hasPreUploadedModel) {
      // Model was already uploaded to storage via either direct object upload
      // or the chunked manifest workaround for large GLBs.
      modelUrl = preUploadedModelUrl
      modelKey = typeof preUploadedModelKey === 'string' ? preUploadedModelKey : `models/${slug}/model.glb`
      modelFileName = typeof preUploadedModelFileName === 'string' ? preUploadedModelFileName : 'model.glb'
      modelFileSize = parseInt(preUploadedModelFileSize, 10) || 0
      modelChunked = preUploadedModelIsChunked
      modelManifest = modelChunked ? preUploadedModelManifest : null
      modelMimeType = modelManifest?.contentType || getContentTypeFromPath(modelFileName)
    } else {
      // Direct upload — buffer model and upload to S3 server-side
      const modelPath = sanitizeStoragePath(
        typeof modelPathValue === 'string' ? modelPathValue : modelFile.name || 'model.glb',
      )
      const modelBuffer = Buffer.from(await modelFile.arrayBuffer())
      modelKey = `models/${slug}/${uploadId}/${modelPath}`
      modelMimeType = getContentType(modelFile, modelPath)

      await uploadBufferToS3Object({
        key: modelKey,
        body: modelBuffer,
        contentType: modelMimeType,
      })

      modelUrl = getPublicStorageUrl(modelKey)
      modelFileName = modelFile.name
      modelFileSize = modelFile.size
      modelChunked = false
      modelManifest = null
    }

    if (modelChunked && (!Array.isArray(modelManifest?.chunks) || modelManifest.chunks.length === 0)) {
      return NextResponse.json({ error: 'Chunked model metadata is missing a valid manifest.' }, { status: 400 })
    }

    // ─── 2. Upload resource files ────────────────────────────────────
    const runtimeAssets = []
    for (let i = 0; i < resourceFiles.length; i++) {
      const resourceFile = resourceFiles[i]
      const resourcePath = sanitizeStoragePath(resourcePaths[i] || resourceFile.name)
      if (!resourcePath) continue

      const resourceBuffer = Buffer.from(await resourceFile.arrayBuffer())
      const resourceKey = `models/${slug}/${uploadId}/${resourcePath}`
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

    // ─── 3. Process thumbnail → WebP → ImgBB ──────────────────────────
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

    // ─── 4. Process texture screenshots if provided ─────────────────────
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

    // ─── 5. Build complete snapshot JSON ───────────────────────────────
    // The snapshot is the single source of truth for the /frame viewer.
    // It must contain EVERY piece of information needed to render the scene.
    const snapshot = {
      version: 1,
      slug,
      // ── Model asset reference ──
      model: {
        url: modelUrl,
        fileName: modelFileName,
        path: modelKey.split('/').slice(2).join('/') || modelFileName,
        fileSize: modelFileSize,
        contentType: modelMimeType,
        optimization: modelOptimization,
        ...(modelChunked ? {
          chunked: true,
          manifestUrl: modelUrl,
          manifestKey: modelKey,
          manifest: modelManifest,
        } : {}),
      },
      // ── Additional runtime assets (textures, bins, etc.) ──
      runtimeAssets,
      // ── Visual preview assets ──
      thumbnail: thumbnailResult ? {
        url: thumbnailResult.url,
        thumbUrl: thumbnailResult.thumbUrl,
      } : null,
      textureAssets,
      // ── Import/normalization config ──
      import: config.import || {},
      // ── Interactive parts registry ──
      parts: config.parts || [],
      // ── Materials config ──
      materials: config.materials || [],
      assetManifest: config.assetManifest || config.model?.assetManifest || null,
      // ── Lighting config (complete) ──
      lighting: config.lighting || {
        intensity: 1,
        ambient: { enabled: true, color: '#ffffff', intensity: 0.35 },
        lights: [
          { type: 'directional', position: [4, 6, -4], intensity: 2.2, color: '#ffffff', castShadow: true },
          { type: 'directional', position: [-4, 3, 3], intensity: 0.8, color: '#dbeafe' },
          { type: 'directional', position: [0, 4, 6], intensity: 1.1, color: '#ffffff' },
        ],
      },
      // ── Environment config ──
      environment: config.environment || { preset: 'studio', background: false, backgroundColor: '#f7f7f4' },
      // ── Camera config ──
      camera: config.camera || { fov: 40, autoFit: true, position: [5, 3, -7] },
      // ── Platform / turntable config ──
      stage: config.stage || {
        backgroundColor: '#f7f7f4',
        shadows: true,
        radialFloorEnabled: true,
        radialFloorColor: '#9aa8bf',
        radialFloorOpacity: 0.42,
        radialFloorInner: 0.14,
        radialFloorOuter: 1.08,
        shadowOpacity: 0.52,
        shadowCatcherOpacity: 0.24,
        shadowBlur: 2.2,
        shadowFar: 8.5,
        shadowScale: 11,
        shadowResolution: 1024,
        shadowColor: '#1f2937',
        environmentIntensity: 1.18,
        backgroundIntensity: 0.75,
      },
      animation: config.animation || { autoRotate: false, rotateSpeed: 0.35 },
      // ── Fog config ──
      fog: config.fog || { enabled: false, color: '#f7f7f4', near: 8, far: 34 },
      // ── Post-processing config ──
      postprocessing: config.postprocessing || {
        enabled: true,
        glare: 0.35,
        grain: 0.06,
        vignette: 0.16,
        exposure: 1.08,
        contrast: 1.08,
        saturation: 1.04,
        bloomThreshold: 0.62,
        bloomIntensity: 0.32,
        sharpness: 0.1,
        chromaticAberration: 0.0007,
      },
      // ── Performance preset ──
      performance: config.performance || { preset: 'high' },
      // ── Branding ──
      branding: { watermark: true, text: 'made in AutoZ' },
      // ── Timestamp ──
      publishedAt: new Date().toISOString(),
    }

    // ─── 6. Save to database ──────────────────────────────────────────
    const nextVersion = existingPublish ? existingPublish.version + 1 : 1
    const assetCreates = [
      {
        assetType: 'model',
        storageProvider: 'supabase_s3',
        publicUrl: modelUrl,
        storagePath: modelKey,
        mimeType: modelMimeType,
        fileName: modelFileName,
        fileSizeBytes: BigInt(modelFileSize || 0),
        metadata: {
          ...(modelChunked ? { chunked: true, manifest: modelManifest } : {}),
          ...(modelOptimization ? { optimization: modelOptimization } : {}),
        },
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

    const newStorageKeys = new Set(collectSnapshotStorageKeys(snapshot, slug))
    const staleKeys = existingPublish
      ? collectSnapshotStorageKeys(existingPublish.snapshot, slug)
        .filter((key) => !newStorageKeys.has(key))
      : []
    if (staleKeys.length > 0) {
      try {
        await deleteStorageObjects(staleKeys)
      } catch (err) {
        console.warn('[Publish API] Failed to delete stale publish storage:', err.message)
      }
    }

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

async function deleteStorageObjects(keys) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))]
  for (let i = 0; i < uniqueKeys.length; i += 1000) {
    const batch = uniqueKeys.slice(i, i + 1000)
    await s3Client.send(new DeleteObjectsCommand({
      Bucket: MODELS_BUCKET,
      Delete: {
        Objects: batch.map((Key) => ({ Key })),
        Quiet: true,
      },
    }))
  }
}

function collectSnapshotStorageKeys(snapshot, slug) {
  if (!snapshot || typeof snapshot !== 'object') return []

  const keys = new Set()
  const add = (key) => {
    if (typeof key !== 'string' || !key) return
    keys.add(key.startsWith('models/') || key.startsWith('assets/') ? key : `models/${slug}/${key}`)
  }
  const addFromPublicStorageUrl = (url) => {
    if (!url || typeof url !== 'string') return
    try {
      const parsed = new URL(url)
      const marker = `/${MODELS_BUCKET}/`
      const markerIndex = parsed.pathname.indexOf(marker)
      if (markerIndex >= 0) add(decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length)))
    } catch {
      // Ignore local demo URLs and malformed values.
    }
  }

  if (snapshot.model?.manifestKey) {
    add(snapshot.model.manifestKey)
    const base = snapshot.model.manifestKey.split('/').slice(0, -1).join('/')
    for (const chunk of snapshot.model.manifest?.chunks ?? []) {
      if (typeof chunk !== 'string') continue
      if (/^https?:\/\//i.test(chunk)) {
        try {
          const parsed = new URL(chunk)
          const marker = `/${MODELS_BUCKET}/`
          const markerIndex = parsed.pathname.indexOf(marker)
          if (markerIndex >= 0) add(decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length)))
        } catch {
          // Ignore malformed absolute chunk URLs.
        }
      } else {
        add(`${base}/${chunk}`.replace(/\/+/g, '/'))
      }
    }
  } else if (snapshot.model?.path) {
    add(snapshot.model.path)
  }

  for (const asset of snapshot.runtimeAssets ?? []) {
    add(asset.key || asset.path)
  }

  const assetManifest = snapshot.assetManifest
    || snapshot.model?.assetManifest
    || snapshot.assets?.assetManifest
    || null
  addFromPublicStorageUrl(assetManifest?.manifestUrl)
  addFromPublicStorageUrl(assetManifest?.url)
  for (const lod of assetManifest?.lods ?? []) {
    add(lod.storagePath)
    addFromPublicStorageUrl(lod.url)
  }

  return [...keys]
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

function parseJsonObject(value) {
  if (!value || typeof value !== 'string') return null

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
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
  return getContentTypeFromPath(path)
}

function getContentTypeFromPath(path) {
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
