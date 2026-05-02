import * as THREE from 'three'

const GLASS_RE = /glass|window|windshield|windscreen|mirror/i
const RUBBER_RE = /rubber|tire|tyre/i
const CHROME_RE = /chrome|rim|wheel|metal|exhaust|trim/i

function asMaterials(material) {
  if (!material) return []
  return Array.isArray(material) ? material.filter(Boolean) : [material]
}

function getReflectionMultiplier(label) {
  if (GLASS_RE.test(label)) return 1.35
  if (CHROME_RE.test(label)) return 1.5
  if (RUBBER_RE.test(label)) return 0.28
  return 1
}

export function applyAutomotiveMaterialTuning(root, options = {}) {
  if (!root) return

  const reflectionIntensity = options.reflectionIntensity ?? 1.2
  const enableShadows = options.shadows !== false
  const touched = new Set()

  root.traverse((object) => {
    if (!object.isMesh) return

    object.frustumCulled = true
    object.castShadow = enableShadows
    object.receiveShadow = enableShadows

    for (const material of asMaterials(object.material)) {
      if (touched.has(material.uuid) || material.isShaderMaterial) continue
      touched.add(material.uuid)
      material.userData ??= {}

      const label = `${object.name || ''} ${material.name || ''}`
      const multiplier = getReflectionMultiplier(label)

      if (material.envMapIntensity !== undefined) {
        if (material.userData.autoZBaseEnvMapIntensity === undefined) {
          material.userData.autoZBaseEnvMapIntensity = material.envMapIntensity || 1
        }
        material.envMapIntensity = material.userData.autoZBaseEnvMapIntensity * reflectionIntensity * multiplier
      }

      if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
        material.roughness = THREE.MathUtils.clamp(material.roughness ?? 0.45, 0.04, 0.96)
        material.metalness = THREE.MathUtils.clamp(material.metalness ?? 0, 0, 1)
        material.toneMapped = true
      }

      if (material.isMeshPhysicalMaterial && !GLASS_RE.test(label) && !RUBBER_RE.test(label)) {
        material.clearcoat = Math.max(material.clearcoat ?? 0, 0.35)
        material.clearcoatRoughness = THREE.MathUtils.clamp(material.clearcoatRoughness ?? 0.18, 0.05, 0.45)
      }

      material.needsUpdate = true
    }
  })
}
