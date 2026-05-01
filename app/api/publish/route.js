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
import { PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { s3Client, MODELS_BUCKET } from '@/config/s3'
import { uploadBufferToImgBB } from '@/config/imgbb'
import prisma from '@/config/prisma'

export async function POST(request) {
  try {
    const formData = await request.formData()

    // ─── Extract fields ───────────────────────────────────────────────
    const modelFile = formData.get('model')       // File: .glb
    const configJson = formData.get('config')     // string: JSON
    const projectName = formData.get('name') || 'Untitled Project'
    const thumbnailFile = formData.get('thumbnail') // File: screenshot (optional)

    if (!modelFile) {
      return NextResponse.json({ error: 'No model file provided' }, { status: 400 })
    }

    const config = configJson ? JSON.parse(configJson) : {}
    const slug = generateSlug(projectName)

    // ─── 1. Upload model to Supabase S3 ────────────────────────────────
    const modelBuffer = Buffer.from(await modelFile.arrayBuffer())
    const modelKey = `models/${slug}/${modelFile.name}`

    await s3Client.send(new PutObjectCommand({
      Bucket: MODELS_BUCKET,
      Key: modelKey,
      Body: modelBuffer,
      ContentType: 'model/gltf-binary',
      CacheControl: 'public, max-age=31536000, immutable',
    }))

    const modelUrl = `${process.env.S3_URL}/object/public/${MODELS_BUCKET}/${modelKey}`

    // ─── 2. Process thumbnail → WebP → ImgBB ──────────────────────────
    let thumbnailResult = null
    if (thumbnailFile) {
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
        fileSize: modelFile.size,
      },
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
      performance: config.performance || { preset: 'high' },
      branding: { watermark: true, text: 'made in AutoZ' },
      publishedAt: new Date().toISOString(),
    }

    // ─── 5. Save to database ──────────────────────────────────────────
    const project = await prisma.project.create({
      data: {
        name: projectName,
        status: 'published',
        assets: {
          create: [
            // Model asset
            {
              assetType: 'model',
              storageProvider: 'supabase_s3',
              publicUrl: modelUrl,
              storagePath: modelKey,
              mimeType: 'model/gltf-binary',
              fileName: modelFile.name,
              fileSizeBytes: BigInt(modelFile.size),
              metadata: {},
            },
            // Thumbnail asset
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
            // Texture assets
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
          ],
        },
        configs: {
          create: {
            config: config,
            version: 1,
          },
        },
        publishes: {
          create: {
            publishSlug: slug,
            snapshot: snapshot,
            version: 1,
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

    return NextResponse.json({
      success: true,
      projectId: project.id,
      slug,
      // Return absolute frame URL so clients and external sites can use it
      frameUrl: absFrame,
      embedCode: `<iframe src="${absFrame}" width="100%" height="600" frameborder="0" allowfullscreen></iframe>`,
    })

  } catch (err) {
    console.error('[Publish API] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateSlug(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40)
  const rand = Math.random().toString(36).substring(2, 8)
  return `${base}-${rand}`
}

function getBaseUrl(request) {
  const host = request.headers.get('host') || 'localhost:3000'
  const proto = request.headers.get('x-forwarded-proto') || 'http'
  return `${proto}://${host}`
}
