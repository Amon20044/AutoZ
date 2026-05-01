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
 * Resolves the most descriptive name for a mesh, considering parent hierarchy.
 * GLB exports from Blender create node→mesh hierarchies where the mesh child
 * may have a generic name (empty, "Mesh", "Object", "mesh_0") while the
 * parent Object3D/Group node has the actual Blender object name.
 *
 * @param {THREE.Object3D} mesh
 * @returns {string}
 */
export function resolveEffectiveName(mesh) {
  // If mesh has a descriptive name, use it
  const ownName = mesh.name?.trim() || ''
  if (ownName && !isGenericName(ownName)) return ownName

  // Walk up to find the nearest named ancestor (GLB node name = Blender object name)
  let current = mesh.parent
  while (current) {
    const parentName = current.name?.trim() || ''
    if (parentName && !isGenericName(parentName) && !isInternalName(parentName)) {
      return parentName
    }
    current = current.parent
  }

  // Fallback to own name or unnamed
  return ownName || '__unnamed__'
}

/** Check if a name is generic/unhelpful for part detection */
export function isGenericName(name) {
  const generic = /^(mesh|object|group|node|primitive|geometry|scene|root|armature|skeleton|collection)([_.\s-]?\d+)?$/i
  return generic.test(name) || name.length === 0
}

/** Check if a name is an internal engine name */
export function isInternalName(name) {
  return name.startsWith('__autoz') || name === 'Scene' || name === 'RootNode'
}

function hasUsableName(object) {
  const name = object.name?.trim() || ''
  return Boolean(name && !isGenericName(name) && !isInternalName(name))
}

function collectDescendantMeshes(object) {
  const meshes = []
  object.traverse((child) => {
    if (child.isMesh) meshes.push(child)
  })
  return meshes
}

function collectMaterials(meshes) {
  const materials = []
  const seen = new Set()
  for (const mesh of meshes) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (!mat || seen.has(mat.uuid)) continue
      seen.add(mat.uuid)
      materials.push(mat)
    }
  }
  return materials
}

function getObjectPath(object, stopAt = null) {
  const parts = []
  let current = object
  while (current && current !== stopAt) {
    if (current.name) parts.unshift(current.name)
    current = current.parent
  }
  return parts.join(' > ')
}

function getObjectDepth(object, stopAt = null) {
  let depth = 0
  let current = object.parent
  while (current && current !== stopAt) {
    depth++
    current = current.parent
  }
  return depth
}

/**
 * Builds a Map<string, THREE.Mesh[]> keyed by mesh name.
 * Uses intelligent name resolution that considers parent node names
 * for GLB files where Blender object names are on parent Object3D nodes.
 *
 * Groups meshes sharing the same effective name.
 * Also stores a flat list at key '__all__'.
 *
 * @param {THREE.Object3D} root
 * @param {boolean} [verbose=false] - Log mesh discovery for diagnostics
 * @returns {Map<string, THREE.Mesh[]>}
 */
export function indexMeshesByName(root, verbose = false) {
  const index = new Map()
  const all = []

  root.traverse((child) => {
    if (!child.isMesh) return
    all.push(child)

    const effectiveName = resolveEffectiveName(child)

    if (verbose) {
      const ownName = child.name || '(empty)'
      const parentName = child.parent?.name || '(no parent)'
      if (effectiveName !== ownName) {
        console.log(`[MeshIndex] "${ownName}" → inherited name "${effectiveName}" from parent "${parentName}"`)
      } else {
        console.log(`[MeshIndex] "${effectiveName}" (parent: "${parentName}")`)
      }
    }

    if (!index.has(effectiveName)) index.set(effectiveName, [])
    index.get(effectiveName).push(child)
  })

  index.set('__all__', all)

  if (verbose) {
    const meshNames = [...index.keys()].filter(k => k !== '__all__')
    console.log(`[MeshIndex] Total: ${all.length} meshes, ${meshNames.length} unique names:`, meshNames)
  }

  return index
}

/**
 * Builds hierarchy-aware part targets. A target is a named Object3D/Group/Mesh
 * with all of its descendant meshes, its world origin, and bounds. This preserves
 * Blender object origins for hinges/spin while still exposing mesh arrays.
 *
 * @param {THREE.Object3D} root
 * @param {boolean} [verbose=false]
 * @returns {Map<string, PartTarget[]>}
 */
export function buildPartTargetIndex(root, verbose = false) {
  root.updateWorldMatrix(true, true)

  const index = new Map()
  const allTargets = []
  const allMeshes = collectMeshes(root)

  root.traverse((object) => {
    if (object === root || isInternalName(object.name || '')) return
    if (!hasUsableName(object)) return

    const meshes = collectDescendantMeshes(object)
    if (meshes.length === 0) return

    const box = new THREE.Box3()
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false)
      box.expandByObject(mesh)
    }

    const origin = new THREE.Vector3()
    object.getWorldPosition(origin)

    const target = {
      id: object.uuid,
      name: object.name.trim(),
      object,
      rootObject: object,
      rootName: object.name.trim(),
      nodePath: getObjectPath(object, root),
      meshes,
      origin,
      bbox: box,
      center: box.getCenter(new THREE.Vector3()),
      size: box.getSize(new THREE.Vector3()),
      materials: collectMaterials(meshes),
      isMesh: !!object.isMesh,
      isGroup: !object.isMesh,
      depth: getObjectDepth(object, root),
    }

    if (!index.has(target.name)) index.set(target.name, [])
    index.get(target.name).push(target)
    allTargets.push(target)
  })

  index.set('__all__', allTargets)
  index.set('__allMeshes__', allMeshes)

  if (verbose) {
    console.log(`[PartTargetIndex] ${allTargets.length} named targets`, allTargets.map(t => t.nodePath))
  }

  return index
}

/**
 * Merges a legacy mesh-name index with part-target names. Values remain Mesh[] so
 * existing material and lookup code can use the returned map unchanged.
 *
 * @param {Map<string, THREE.Mesh[]>} meshIndex
 * @param {Map<string, PartTarget[]>} targetIndex
 * @returns {Map<string, THREE.Mesh[]>}
 */
export function mergeTargetMeshesIntoIndex(meshIndex, targetIndex) {
  const merged = new Map(meshIndex)
  for (const [name, targets] of targetIndex) {
    if (name === '__all__' || name === '__allMeshes__') continue
    const meshes = targets.flatMap((target) => target.meshes)
    if (!merged.has(name)) {
      merged.set(name, meshes)
    } else {
      const byUuid = new Map()
      for (const mesh of [...merged.get(name), ...meshes]) byUuid.set(mesh.uuid, mesh)
      merged.set(name, [...byUuid.values()])
    }
  }
  merged.set('__targets__', targetIndex.get('__all__') ?? [])
  return merged
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
  return getObjectPath(mesh)
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
