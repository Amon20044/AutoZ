const TEXTURE_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'envMap',
  'bumpMap',
  'displacementMap',
  'lightMap',
  'specularMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
]

function disposeMaterial(material) {
  if (!material) return

  for (const key of TEXTURE_KEYS) {
    const texture = material[key]
    if (texture?.dispose) texture.dispose()
  }

  material.dispose?.()
}

export function disposeObject3D(object) {
  if (!object) return

  object.traverse((child) => {
    if (child.geometry?.dispose) child.geometry.dispose()

    if (Array.isArray(child.material)) {
      child.material.forEach(disposeMaterial)
    } else {
      disposeMaterial(child.material)
    }
  })

  if (object.parent) object.parent.remove(object)
}
