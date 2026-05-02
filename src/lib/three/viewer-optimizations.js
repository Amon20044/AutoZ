import * as THREE from 'three'

export function applyViewerOptimizations(renderer, scene, deviceProfile) {
  if (!renderer || !deviceProfile) return

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, deviceProfile.maxDpr))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = Boolean(deviceProfile.allowShadows)

  if (scene) {
    scene.traverse((object) => {
      if (object.isMesh) {
        object.frustumCulled = true
        object.castShadow = Boolean(deviceProfile.allowShadows && object.castShadow)
        object.receiveShadow = Boolean(deviceProfile.allowShadows && object.receiveShadow)
      }
      if (object.isLight && object.shadow) {
        object.shadow.mapSize.width = deviceProfile.deviceClass === 'desktop' ? 1024 : 512
        object.shadow.mapSize.height = deviceProfile.deviceClass === 'desktop' ? 1024 : 512
      }
    })
  }
}

export function getRendererDebugStats(renderer) {
  if (!renderer?.info) return null

  const info = renderer.info
  return {
    calls: info.render.calls,
    triangles: info.render.triangles,
    points: info.render.points,
    lines: info.render.lines,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: info.programs?.length || 0,
    gpuMemoryEstimateMb: Math.round(((info.memory.geometries * 0.8) + (info.memory.textures * 4)) * 10) / 10,
  }
}
