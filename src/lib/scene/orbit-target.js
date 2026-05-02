/**
 * OrbitControls target aligned to normalized import bounds when available.
 * Export shape matches THREE.Vector3 tuple [x,y,z].
 */
export function orbitTargetFromImport(importConfig, fallback = [0, 0.8, 0]) {
  const bb = importConfig?.boundingBoxNormalized
  if (!bb?.min || !bb?.max || bb.min.length < 3 || bb.max.length < 3) {
    return fallback
  }

  const x = ((bb.min[0] ?? 0) + (bb.max[0] ?? 0)) / 2
  const y = ((bb.min[1] ?? 0) + (bb.max[1] ?? 0)) / 2
  const z = ((bb.min[2] ?? 0) + (bb.max[2] ?? 0)) / 2
  const clampedY = Number.isFinite(y) ? Math.max(y, 0.04) : fallback[1]

  if (!Number.isFinite(x) && !Number.isFinite(z)) return fallback
  return [Number.isFinite(x) ? x : 0, clampedY, Number.isFinite(z) ? z : 0]
}
