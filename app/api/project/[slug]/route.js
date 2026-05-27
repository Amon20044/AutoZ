/**
 * GET /api/project/[slug]
 * Fetches a published snapshot by slug for the iframe viewer.
 */
import { NextResponse } from 'next/server'
import prisma from '@/config/prisma'
import { normalizePublishId } from '@/lib/publish-ids'

/**
 * Rewrite legacy S3-endpoint URLs in a snapshot to the correct Supabase
 * Storage REST public URL format. Previously, URLs were incorrectly
 * built from S3_URL (e.g. xxx.storage.supabase.co/storage/v1/s3/...)
 * instead of the REST API (xxx.supabase.co/storage/v1/object/public/...).
 */
function fixLegacyStorageUrl(url) {
  if (!url || typeof url !== 'string') return url
  try {
    const parsed = new URL(url)
    if (
      parsed.hostname.endsWith('.storage.supabase.co') &&
      parsed.pathname.includes('/storage/v1/s3/')
    ) {
      parsed.hostname = parsed.hostname.replace('.storage.supabase.co', '.supabase.co')
      parsed.pathname = parsed.pathname.replace('/storage/v1/s3/', '/storage/v1/')
      return parsed.toString()
    }
  } catch { /* return as-is */ }
  return url
}

function normalizeSnapshotUrls(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot
  const fixed = { ...snapshot }

  if (fixed.model?.url || fixed.model?.manifest?.chunks?.length || fixed.model?.manifestUrl) {
    fixed.model = { ...fixed.model }
    fixed.model.url = fixLegacyStorageUrl(fixed.model.url)
    fixed.model.manifestUrl = fixLegacyStorageUrl(fixed.model.manifestUrl)

    const { manifest } = fixed.model
    if (manifest && Array.isArray(manifest.chunks)) {
      fixed.model.manifest = {
        ...manifest,
        chunks: manifest.chunks.map((c) => (typeof c === 'string' ? fixLegacyStorageUrl(c) : c)),
      }
    }
  }

  const fixLodList = (lods = []) =>
    lods.map((lod) => (lod && typeof lod === 'object' && typeof lod.url === 'string')
      ? { ...lod, url: fixLegacyStorageUrl(lod.url) }
      : lod)

  if (fixed.assetManifest && typeof fixed.assetManifest === 'object') {
    fixed.assetManifest = {
      ...fixed.assetManifest,
      manifestUrl: fixLegacyStorageUrl(fixed.assetManifest.manifestUrl),
      lods: fixLodList(fixed.assetManifest.lods),
    }
  }
  if (fixed.model?.assetManifest && typeof fixed.model.assetManifest === 'object') {
    fixed.model = {
      ...fixed.model,
      assetManifest: {
        ...fixed.model.assetManifest,
        manifestUrl: fixLegacyStorageUrl(fixed.model.assetManifest.manifestUrl),
        lods: fixLodList(fixed.model.assetManifest.lods),
      },
    }
  }
  if (fixed.assets?.assetManifest && typeof fixed.assets.assetManifest === 'object') {
    fixed.assets = {
      ...fixed.assets,
      assetManifest: {
        ...fixed.assets.assetManifest,
        manifestUrl: fixLegacyStorageUrl(fixed.assets.assetManifest.manifestUrl),
        lods: fixLodList(fixed.assets.assetManifest.lods),
      },
    }
  }

  if (Array.isArray(fixed.runtimeAssets)) {
    fixed.runtimeAssets = fixed.runtimeAssets.map((a) => ({
      ...a,
      url: fixLegacyStorageUrl(a.url),
    }))
  }

  return fixed
}

export async function GET(request, { params }) {
  try {
    if (!prisma) {
      return NextResponse.json({ error: 'Database is not configured on this deployment.' }, { status: 500 })
    }

    const { slug: slugParam } = await params
    const raw = typeof slugParam === 'string' ? slugParam.trim() : ''
    const slug = normalizePublishId(raw) || raw || ''

    if (!slug || slug.length < 2) {
      return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
    }

    const publish = await prisma.publish.findUnique({
      where: { publishSlug: slug },
      select: {
        id: true,
        publishSlug: true,
        snapshot: true,
        version: true,
        isPublic: true,
        createdAt: true,
        project: { select: { id: true, name: true } },
      },
    })

    if (!publish) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (!publish.isPublic) {
      return NextResponse.json({ error: 'This project is private' }, { status: 403 })
    }

    return NextResponse.json({
      success: true,
      publish: {
        id: publish.id,
        slug: publish.publishSlug,
        version: publish.version,
        projectName: publish.project.name,
        snapshot: normalizeSnapshotUrls(publish.snapshot),
        createdAt: publish.createdAt,
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch (err) {
    console.error('[Project API] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
