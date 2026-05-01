/**
 * GET /api/project/[slug]
 * Fetches a published snapshot by slug for the iframe viewer.
 */
import { NextResponse } from 'next/server'
import prisma from '@/config/prisma'

export async function GET(request, { params }) {
  try {
    const { slug } = params

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
        snapshot: publish.snapshot,
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
