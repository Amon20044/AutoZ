import { LOD_VARIANTS } from './lod-profiles.js'

export function getAssetManifestLods(manifest) {
  return Array.isArray(manifest?.lods) ? manifest.lods : []
}

export function getMissingLodIds(manifest) {
  const lodsById = new Map(
    getAssetManifestLods(manifest)
      .filter((lod) => lod?.id)
      .map((lod) => [lod.id, lod]),
  )

  return LOD_VARIANTS
    .filter((variant) => {
      const lod = lodsById.get(variant.id)
      return !lod?.url || !(Number(lod.bytes) > 0)
    })
    .map((variant) => variant.id)
}

export function isCompleteAssetManifest(manifest) {
  return Boolean(
    manifest
    && typeof manifest === 'object'
    && !Array.isArray(manifest)
    && getMissingLodIds(manifest).length === 0,
  )
}

export function pickDeviceLod(assetManifest, deviceClass) {
  const lods = [...getAssetManifestLods(assetManifest)]
    .filter((lod) => lod?.url)

  if (lods.length === 0) return null

  const exactMatches = lods.filter((lod) => (
    Array.isArray(lod.device)
    && lod.device.includes(deviceClass)
  ))
  const pool = exactMatches.length ? exactMatches : lods

  pool.sort((a, b) => {
    const pa = Number.isFinite(a.priority) ? a.priority : 99
    const pb = Number.isFinite(b.priority) ? b.priority : 99
    if (pa !== pb) return pa - pb
    return (Number(a.bytes) || 1e18) - (Number(b.bytes) || 1e18)
  })

  return pool[0] ?? null
}
