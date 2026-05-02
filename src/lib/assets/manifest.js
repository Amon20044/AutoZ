import { DEVICE_PROFILE_DEFAULTS, LOD_VARIANTS } from './lod-profiles.js'

export function normalizeAssetPath(key = '') {
  return String(key)
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => part.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'asset')
    .join('/')
}

export function createBaseAssetManifest({
  assetId,
  fileName,
  originalBytes,
  publicUrls = {},
  lodMetadata = {},
  storedOriginal = false,
  stats = {},
  compression = {},
}) {
  const now = new Date().toISOString()

  return {
    assetId,
    version: 1,
    createdAt: now,
    source: {
      fileName,
      originalBytes,
      storedOriginal,
    },
    coordinateSystem: {
      up: 'Y',
      forward: 'Z',
    },
    compression: {
      geometry: compression.geometry || 'meshopt',
      textures: compression.textures || 'webp',
      textureFallback: compression.textureFallback || 'webp',
    },
    deviceProfiles: DEVICE_PROFILE_DEFAULTS,
    lods: LOD_VARIANTS.map((lod) => ({
      id: lod.id,
      url: publicUrls[lod.key] || `/assets/${assetId}/${lod.key}`,
      device: lod.device,
      triangleRatio: lod.triangleRatio,
      maxTextureSize: lod.maxTextureSize,
      distanceMin: lod.distanceMin,
      distanceMax: lod.distanceMax,
      bytes: lodMetadata[lod.id]?.bytes || 0,
      triangles: lodMetadata[lod.id]?.triangles || 0,
      priority: lod.priority,
    })),
    stats: {
      originalTriangles: stats.originalTriangles || 0,
      materialCount: stats.materialCount || 0,
      textureCount: stats.textureCount || 0,
      drawCallEstimate: stats.drawCallEstimate || 0,
      lods: Object.fromEntries(
        Object.entries(lodMetadata).map(([id, meta]) => [
          id,
          {
            triangles: meta.triangles || 0,
            bytes: meta.bytes || 0,
          },
        ]),
      ),
    },
  }
}

export function validateAssetManifest(value) {
  const errors = []

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['Manifest must be an object.'] }
  }

  if (!value.assetId || typeof value.assetId !== 'string') {
    errors.push('assetId is required.')
  }

  if (!Array.isArray(value.lods) || value.lods.length === 0) {
    errors.push('lods must be a non-empty array.')
  } else {
    for (const lod of value.lods) {
      if (!lod.id || typeof lod.id !== 'string') errors.push('Each LOD needs an id.')
      if (!lod.url || typeof lod.url !== 'string') errors.push(`LOD ${lod.id || '?'} needs a url.`)
      if (!Array.isArray(lod.device) || lod.device.length === 0) errors.push(`LOD ${lod.id || '?'} needs device targets.`)
    }
  }

  for (const device of ['mobile', 'tablet', 'desktop']) {
    if (!value.deviceProfiles?.[device]?.firstLod) {
      errors.push(`deviceProfiles.${device}.firstLod is required.`)
    }
  }

  return { valid: errors.length === 0, errors }
}
