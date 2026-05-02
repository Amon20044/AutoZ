export const LOD_VARIANTS = [
  {
    id: 'mobile-low',
    fileName: 'lod-mobile-low.glb',
    key: 'lods/lod-mobile-low.glb',
    device: ['mobile'],
    triangleRatio: 0.08,
    minRatio: 0.05,
    maxRatio: 0.12,
    maxTextureSize: 512,
    distanceMin: 8,
    distanceMax: 9999,
    priority: 1,
  },
  {
    id: 'mobile-medium',
    fileName: 'lod-mobile-medium.glb',
    key: 'lods/lod-mobile-medium.glb',
    device: ['mobile'],
    triangleRatio: 0.2,
    minRatio: 0.15,
    maxRatio: 0.25,
    maxTextureSize: 1024,
    distanceMin: 0,
    distanceMax: 8,
    priority: 2,
  },
  {
    id: 'tablet-low',
    fileName: 'lod-tablet-low.glb',
    key: 'lods/lod-tablet-low.glb',
    device: ['tablet'],
    triangleRatio: 0.16,
    minRatio: 0.12,
    maxRatio: 0.2,
    maxTextureSize: 1024,
    distanceMin: 10,
    distanceMax: 9999,
    priority: 1,
  },
  {
    id: 'tablet-high',
    fileName: 'lod-tablet-high.glb',
    key: 'lods/lod-tablet-high.glb',
    device: ['tablet'],
    triangleRatio: 0.38,
    minRatio: 0.3,
    maxRatio: 0.45,
    maxTextureSize: 1536,
    distanceMin: 0,
    distanceMax: 10,
    priority: 2,
  },
  {
    id: 'desktop-low',
    fileName: 'lod-desktop-low.glb',
    key: 'lods/lod-desktop-low.glb',
    device: ['desktop'],
    triangleRatio: 0.3,
    minRatio: 0.2,
    maxRatio: 0.35,
    maxTextureSize: 1024,
    distanceMin: 14,
    distanceMax: 9999,
    priority: 1,
  },
  {
    id: 'desktop-high',
    fileName: 'lod-desktop-high.glb',
    key: 'lods/lod-desktop-high.glb',
    device: ['desktop'],
    triangleRatio: 0.85,
    minRatio: 0.6,
    maxRatio: 1,
    maxTextureSize: 2048,
    distanceMin: 0,
    distanceMax: 14,
    priority: 3,
  },
]

export const DEVICE_PROFILE_DEFAULTS = {
  mobile: {
    firstLod: 'mobile-low',
    maxDpr: 1,
    maxTextureSize: 512,
  },
  tablet: {
    firstLod: 'tablet-low',
    maxDpr: 1.5,
    maxTextureSize: 1024,
  },
  desktop: {
    firstLod: 'desktop-low',
    maxDpr: 2,
    maxTextureSize: 2048,
  },
}

export function getLodById(id) {
  return LOD_VARIANTS.find((lod) => lod.id === id) ?? null
}

export function getExpectedAssetFiles({ includeOriginal = false, includeThumbnail = false } = {}) {
  const files = LOD_VARIANTS.map((lod) => ({
    key: lod.key,
    contentType: 'model/gltf-binary',
  }))

  files.push({
    key: 'manifest.json',
    contentType: 'application/json',
  })

  if (includeOriginal) {
    files.push({
      key: 'source/source-original.glb',
      contentType: 'model/gltf-binary',
    })
  }

  if (includeThumbnail) {
    files.push({
      key: 'thumbs/thumbnail.webp',
      contentType: 'image/webp',
    })
  }

  return files
}
