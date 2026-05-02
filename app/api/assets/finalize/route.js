import { NextResponse } from 'next/server'
import { HeadObjectCommand } from '@aws-sdk/client-s3'
import prisma from '@/config/prisma'
import { MODELS_BUCKET, s3Client } from '@/config/s3'
import { normalizeAssetPath, validateAssetManifest } from '@/lib/assets/manifest'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getStorageKey(assetId, key) {
  return `assets/${assetId}/${normalizeAssetPath(key)}`
}

async function assertUploadedObject(assetId, key, expectedBytes = 0) {
  const storagePath = getStorageKey(assetId, key)
  const result = await s3Client.send(new HeadObjectCommand({
    Bucket: MODELS_BUCKET,
    Key: storagePath,
  }))

  if (expectedBytes > 0 && typeof result.ContentLength === 'number' && result.ContentLength !== expectedBytes) {
    throw new Error(`${key} uploaded ${result.ContentLength} bytes, expected ${expectedBytes}.`)
  }

  return storagePath
}

export async function POST(request) {
  try {
    if (!prisma) {
      return NextResponse.json({ error: 'Database is not configured.' }, { status: 500 })
    }

    const body = await request.json()
    const assetId = typeof body.assetId === 'string' ? body.assetId : ''
    const manifest = body.manifest

    if (!assetId) {
      return NextResponse.json({ error: 'assetId is required.' }, { status: 400 })
    }

    const validation = validateAssetManifest(manifest)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors.join(' ') }, { status: 400 })
    }

    if (manifest.assetId !== assetId) {
      return NextResponse.json({ error: 'Manifest assetId does not match request assetId.' }, { status: 400 })
    }

    const existing = await prisma.project.findUnique({
      where: { id: assetId },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 })
    }

    await assertUploadedObject(assetId, 'manifest.json')
    await Promise.all(
      manifest.lods.map((lod) => assertUploadedObject(
        assetId,
        `lods/lod-${lod.id}.glb`,
        Number(lod.bytes || 0),
      )),
    )

    const assetCreates = [
      {
        assetType: 'optimized_manifest',
        storageProvider: 'supabase_s3',
        publicUrl: manifest.url || manifest.manifestUrl || '',
        storagePath: getStorageKey(assetId, 'manifest.json'),
        mimeType: 'application/json',
        fileName: 'manifest.json',
        fileSizeBytes: BigInt(JSON.stringify(manifest).length),
        metadata: { manifest },
      },
      ...manifest.lods.map((lod) => ({
        assetType: 'optimized_lod',
        storageProvider: 'supabase_s3',
        publicUrl: lod.url,
        storagePath: getStorageKey(assetId, `lods/lod-${lod.id}.glb`),
        mimeType: 'model/gltf-binary',
        fileName: `lod-${lod.id}.glb`,
        fileSizeBytes: BigInt(lod.bytes || 0),
        metadata: {
          lodId: lod.id,
          device: lod.device,
          triangleRatio: lod.triangleRatio,
          triangles: lod.triangles || 0,
          bucket: MODELS_BUCKET,
        },
      })),
    ]

    await prisma.project.update({
      where: { id: assetId },
      data: {
        status: 'asset_ready',
        configs: {
          create: {
            version: 1,
            config: { assetManifest: manifest },
          },
        },
        assets: { create: assetCreates },
      },
    })

    return NextResponse.json({ success: true, assetId })
  } catch (err) {
    console.error('[Assets Finalize API] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
