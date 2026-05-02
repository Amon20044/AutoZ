import { NextResponse } from 'next/server'
import prisma from '@/config/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_request, { params }) {
  try {
    if (!prisma) {
      return NextResponse.json({ error: 'Database is not configured.' }, { status: 500 })
    }

    const { assetId } = await params
    const project = await prisma.project.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        status: true,
        configs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { config: true },
        },
      },
    })

    const manifest = project?.configs?.[0]?.config?.assetManifest
    if (!project || !manifest) {
      return NextResponse.json({ error: 'Asset manifest not found.' }, { status: 404 })
    }

    return NextResponse.json(manifest, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
      },
    })
  } catch (err) {
    console.error('[Asset Manifest API] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
