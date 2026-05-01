import { NextResponse } from 'next/server'
import prisma from '@/config/prisma'
import { generateUniquePublishId, getUsedPublishIds } from '@/lib/publish-ids'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    if (!prisma) {
      return NextResponse.json({ error: 'Database is not configured on this deployment.' }, { status: 500 })
    }

    const usedIds = await getUsedPublishIds(prisma)
    const publishId = generateUniquePublishId(usedIds)

    return NextResponse.json({
      success: true,
      publishId,
      existingCount: usedIds.size,
    }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[Publish ID API] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
