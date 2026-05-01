/**
 * @module engine/core/material-engine
 * Config-driven material application: car paint, glass, rubber, emissive lights.
 * Applies material overrides to scene meshes from snapshot config.
 */

import * as THREE from 'three'

// ─── Material Presets ────────────────────────────────────────────────────────

/** Canonical material preset configs */
export const MATERIAL_PRESETS = Object.freeze({
  carPaint: {
    metalness: 0.75, roughness: 0.28, clearcoat: 1.0,
    clearcoatRoughness: 0.15, envMapIntensity: 1.2,
  },
  glass: {
    metalness: 0, roughness: 0.05, transmission: 0.4,
    opacity: 0.45, transparent: true, envMapIntensity: 1.4,
  },
  rubber: {
    metalness: 0, roughness: 0.82, envMapIntensity: 0.1,
  },
  chrome: {
    metalness: 1.0, roughness: 0.05, envMapIntensity: 1.5,
  },
  plastic: {
    metalness: 0, roughness: 0.6, envMapIntensity: 0.4,
  },
  emissiveLight: {
    metalness: 0, roughness: 0.5,
  },
})

/** Reflection multipliers per category */
export const REFLECTION_MULTIPLIERS = Object.freeze({
  body: 1.0, glass: 1.35, chrome: 1.5, rubber: 0.1,
  plastic: 0.4, default: 0.8,
})

// ─── Material Factory ────────────────────────────────────────────────────────

/**
 * Creates or updates a THREE.MeshPhysicalMaterial from a config block.
 * @param {object} config - Material config from snapshot
 * @param {THREE.MeshPhysicalMaterial} [existing] - Existing material to mutate
 * @returns {THREE.MeshPhysicalMaterial}
 */
export function buildMaterial(config, existing = null) {
  const preset = MATERIAL_PRESETS[config.type] ?? {}
  const props = { ...preset, ...config.properties }

  const mat = existing ?? new THREE.MeshPhysicalMaterial()
  mat.name = config.id || mat.name

  if (props.baseColor !== undefined) mat.color.set(props.baseColor)
  if (props.metalness !== undefined) mat.metalness = props.metalness
  if (props.roughness !== undefined) mat.roughness = props.roughness
  if (props.clearcoat !== undefined) mat.clearcoat = props.clearcoat
  if (props.clearcoatRoughness !== undefined) mat.clearcoatRoughness = props.clearcoatRoughness
  if (props.envMapIntensity !== undefined) mat.envMapIntensity = props.envMapIntensity
  if (props.transmission !== undefined) mat.transmission = props.transmission
  if (props.opacity !== undefined) mat.opacity = props.opacity
  if (props.transparent !== undefined) mat.transparent = props.transparent
  if (props.emissiveColor !== undefined) mat.emissive.set(props.emissiveColor)
  if (props.emissiveIntensity !== undefined) mat.emissiveIntensity = props.emissiveIntensity

  mat.needsUpdate = true
  return mat
}

// ─── Reflection Intensity ────────────────────────────────────────────────────

/**
 * Apply reflection intensity config to a material.
 * envMapIntensity_final = base * reflectionMultiplier * globalIntensity
 *
 * @param {THREE.Material} mat
 * @param {string} category - Part category
 * @param {number} globalIntensity - From scene reflection config
 */
export function applyReflectionIntensity(mat, category, globalIntensity = 1.0) {
  const multiplier = REFLECTION_MULTIPLIERS[category] ?? REFLECTION_MULTIPLIERS.default
  if (mat.envMapIntensity !== undefined) {
    mat.envMapIntensity = (MATERIAL_PRESETS[mat._autoZType]?.envMapIntensity ?? 1.0) * multiplier * globalIntensity
  }
}

// ─── Apply Materials from Snapshot ──────────────────────────────────────────

/**
 * Applies all material overrides from snapshot config to scene meshes.
 *
 * @param {Map<string, THREE.Mesh[]>} meshIndex - From indexMeshesByName()
 * @param {object[]} materials - snapshot.materials array
 * @param {number} [globalReflectionIntensity=1.0]
 * @returns {Map<string, THREE.Material>} materialId → applied material
 */
export function applyMaterials(meshIndex, materials, globalReflectionIntensity = 1.0) {
  const applied = new Map()

  for (const matConfig of materials) {
    const mat = buildMaterial(matConfig)
    mat._autoZType = matConfig.type
    applied.set(matConfig.id, mat)

    const meshNames = matConfig.meshNames ?? []
    for (const name of meshNames) {
      const meshes = meshIndex.get(name)
      if (!meshes) continue
      for (const mesh of meshes) {
        mesh.material = mat
        applyReflectionIntensity(mat, matConfig.target, globalReflectionIntensity)
      }
    }
  }

  return applied
}

// ─── Color Variant Switcher ──────────────────────────────────────────────────

/**
 * Applies a color variant from a material config's variants array.
 * Does NOT animate — for instant switch (use interaction-engine for animated lerp).
 *
 * @param {THREE.Material} mat
 * @param {object} matConfig - Material config with variants[]
 * @param {string} variantId
 */
export function applyVariant(mat, matConfig, variantId) {
  const variant = (matConfig.variants ?? []).find((v) => v.id === variantId)
  if (!variant) return
  if (variant.baseColor) mat.color.set(variant.baseColor)
  if (variant.metalness !== undefined) mat.metalness = variant.metalness
  if (variant.roughness !== undefined) mat.roughness = variant.roughness
  mat.needsUpdate = true
}

/**
 * Get all variant options from a material config.
 * @param {object} matConfig
 * @returns {{ id: string, label: string, color: string }[]}
 */
export function getVariantOptions(matConfig) {
  return (matConfig.variants ?? []).map((v) => ({
    id: v.id, label: v.label, color: v.baseColor,
  }))
}
