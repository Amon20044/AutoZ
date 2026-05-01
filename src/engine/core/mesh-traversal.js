/**
 * @module engine/core/mesh-traversal
 * Scene graph traversal, mesh indexing, hierarchy analysis.
 * This is the core engine that walks a loaded GLTF scene and builds
 * a queryable index of every mesh, material, and node.
 */
import * as THREE from 'three'

/**
 * Traverses an Object3D tree and collects all meshes.
 * @param {THREE.Object3D} root
 * @returns {THREE.Mesh[]}
 */
export function collectMeshes(root) {
  const meshes = []
  root.traverse((child) => {
    if (child.isMesh) meshes.push(child)
  })
  return meshes
}

/**
 * Builds a Map<string, THREE.Mesh[]> keyed by mesh name.
 * Groups meshes sharing the same name (e.g. "Body.001", "Body.002").
 * Also stores a flat list at key '__all__'.
 *
 * @param {THREE.Object3D} root
 * @returns {Map<string, THREE.Mesh[]>}
 */
export function indexMeshesByName(root) {
  const index = new Map()
  const all = []
  root.traverse((child) => {
    if (!child.isMesh) return
    all.push(child)
    const name = child.name || '__unnamed__'
    if (!index.has(name)) index.set(name, [])
    index.get(name).push(child)
  })
  index.set('__all__', all)
  return index
}

/**
 * Builds a full scene graph tree structure for inspection.
 * @param {THREE.Object3D} root
 * @param {number} [depth=0]
 * @returns {SceneNode}
 */
export function buildSceneGraph(root, depth = 0) {
  const node = {
    name: root.name || `<${root.type}>`,
    type: root.type,
    uuid: root.uuid,
    isMesh: !!root.isMesh,
    depth,
    position: root.position.toArray(),
    rotation: root.rotation.toArray().slice(0, 3),
    scale: root.scale.toArray(),
    children: [],
  }

  if (root.isMesh) {
    const geo = root.geometry
    node.geometry = {
      vertices: geo.attributes.position ? geo.attributes.position.count : 0,
      triangles: geo.index ? geo.index.count / 3 : (geo.attributes.position ? geo.attributes.position.count / 3 : 0),
      hasNormals: !!geo.attributes.normal,
      hasUVs: !!geo.attributes.uv,
    }
    node.material = Array.isArray(root.material)
      ? root.material.map(matInfo)
      : matInfo(root.material)
  }

  for (const child of root.children) {
    node.children.push(buildSceneGraph(child, depth + 1))
  }
  return node
}

function matInfo(mat) {
  if (!mat) return null
  return {
    name: mat.name, type: mat.type,
    color: mat.color ? '#' + mat.color.getHexString() : null,
    metalness: mat.metalness, roughness: mat.roughness,
    transparent: mat.transparent, opacity: mat.opacity,
    emissive: mat.emissive ? '#' + mat.emissive.getHexString() : null,
  }
}

/**
 * Computes per-mesh world bounding boxes for all meshes in a scene.
 * @param {THREE.Object3D} root
 * @returns {Map<string, { mesh: THREE.Mesh, bbox: THREE.Box3, center: THREE.Vector3, size: THREE.Vector3 }>}
 */
export function computeMeshBounds(root) {
  root.updateWorldMatrix(true, true)
  const bounds = new Map()
  root.traverse((child) => {
    if (!child.isMesh) return
    const box = new THREE.Box3().setFromObject(child)
    bounds.set(child.uuid, {
      mesh: child,
      name: child.name,
      bbox: box,
      center: box.getCenter(new THREE.Vector3()),
      size: box.getSize(new THREE.Vector3()),
    })
  })
  return bounds
}

/**
 * Finds meshes by name pattern (exact, prefix, or contains).
 * @param {Map<string, THREE.Mesh[]>} meshIndex
 * @param {string} pattern
 * @param {'exact'|'prefix'|'contains'} [mode='contains']
 * @returns {THREE.Mesh[]}
 */
export function findMeshes(meshIndex, pattern, mode = 'contains') {
  const results = []
  const lower = pattern.toLowerCase()
  for (const [name, meshes] of meshIndex) {
    if (name === '__all__') continue
    const n = name.toLowerCase()
    const match = mode === 'exact' ? n === lower
      : mode === 'prefix' ? n.startsWith(lower)
      : n.includes(lower)
    if (match) results.push(...meshes)
  }
  return results
}

/**
 * Groups meshes by material — useful for batching and part inference.
 * @param {THREE.Object3D} root
 * @returns {Map<string, THREE.Mesh[]>} Material name → meshes
 */
export function groupByMaterial(root) {
  const groups = new Map()
  root.traverse((child) => {
    if (!child.isMesh) return
    const mats = Array.isArray(child.material) ? child.material : [child.material]
    for (const mat of mats) {
      const key = mat.name || mat.uuid
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(child)
    }
  })
  return groups
}

/**
 * Gets the full hierarchy path of a mesh (e.g. "Car > Body > DoorFL").
 * @param {THREE.Object3D} mesh
 * @returns {string}
 */
export function getMeshPath(mesh) {
  const parts = []
  let current = mesh
  while (current) {
    if (current.name) parts.unshift(current.name)
    current = current.parent
  }
  return parts.join(' > ')
}

/**
 * Collects scene statistics.
 * @param {THREE.Object3D} root
 */
export function getSceneStats(root) {
  let meshCount = 0, totalVertices = 0, totalTriangles = 0, materialSet = new Set()
  root.traverse((child) => {
    if (!child.isMesh) return
    meshCount++
    const geo = child.geometry
    if (geo.attributes.position) totalVertices += geo.attributes.position.count
    totalTriangles += geo.index ? geo.index.count / 3 : (geo.attributes.position ? geo.attributes.position.count / 3 : 0)
    const mats = Array.isArray(child.material) ? child.material : [child.material]
    mats.forEach((m) => materialSet.add(m.name || m.uuid))
  })
  return { meshCount, totalVertices, totalTriangles, uniqueMaterials: materialSet.size }
}
