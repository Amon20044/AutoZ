import { randomBytes } from 'node:crypto'

const DEFAULT_PAGE_SIZE = 1000
const MAX_PUBLISH_ID_LENGTH = 64
const MIN_PUBLISH_ID_LENGTH = 4
const RESERVED_PUBLISH_IDS = new Set([
  'api',
  'app',
  'admin',
  'assets',
  'editor',
  'frame',
  'publish',
  'project',
  'static',
  'www',
])

export function normalizePublishId(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_PUBLISH_ID_LENGTH)
    .replace(/^-|-$/g, '')

  if (normalized.length < MIN_PUBLISH_ID_LENGTH) return null
  if (RESERVED_PUBLISH_IDS.has(normalized)) return null

  return normalized
}

export async function getUsedPublishIds(prisma, pageSize = DEFAULT_PAGE_SIZE) {
  const usedIds = new Set()

  for (let skip = 0; ; skip += pageSize) {
    const rows = await prisma.publish.findMany({
      select: { publishSlug: true },
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip,
    })

    for (const row of rows) {
      const id = normalizePublishId(row.publishSlug)
      if (id) usedIds.add(id)
    }

    if (rows.length < pageSize) break
  }

  return usedIds
}

export function generateUniquePublishId(usedIds = new Set()) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const candidate = normalizePublishId(`az-${randomBytes(5).toString('hex')}`)
    if (candidate && !usedIds.has(candidate)) return candidate
  }

  const fallback = normalizePublishId(`az-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`)
  if (!fallback || usedIds.has(fallback)) {
    throw new Error('Unable to generate a unique publish ID.')
  }

  return fallback
}

export async function resolvePublishId(prisma, preferredId = null) {
  const usedIds = await getUsedPublishIds(prisma)
  const normalizedPreferredId = normalizePublishId(preferredId)

  if (normalizedPreferredId && !usedIds.has(normalizedPreferredId)) {
    return {
      publishId: normalizedPreferredId,
      changed: false,
      existingCount: usedIds.size,
    }
  }

  return {
    publishId: generateUniquePublishId(usedIds),
    changed: Boolean(normalizedPreferredId),
    existingCount: usedIds.size,
  }
}
