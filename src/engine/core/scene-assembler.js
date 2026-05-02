/**
 * @module engine/core/scene-assembler
 * Assembles the full runtime 3D scene from a publish snapshot.
 *
 * This is the top-level orchestrator called by the Runtime Viewer.
 * Implements the 20-step algorithm from PRD §22.
 *
 * Usage (in a React Three Fiber component):
 *   const engine = useRef(new AutoZEngine())
 *   useEffect(() => { engine.current.load(snapshot) }, [snapshot])
 *   useFrame((state, dt) => engine.current.update(dt, state.clock.elapsedTime))
 */

import * as THREE from 'three'
import { buildPartRegistry } from './part-builder.js'
import { applyNormalization } from '../math/normalization.js'
import { applyMaterials } from './material-engine.js'
import { InteractionEngine } from './interaction-engine.js'
import { computeAutoFitCamera } from '../math/camera.js'
import { AdaptiveQuality } from '../math/quality.js'
import { applyAutomotiveMaterialTuning } from '../../lib/three/studio-rendering.js'

// ─── AutoZ Engine ────────────────────────────────────────────────────────────

/**
 * Core engine class. Framework-agnostic — works with any Three.js context.
 * Bind to React Three Fiber via useFrame + useEffect.
 */
export class AutoZEngine {
  constructor() {
    this.registry = null
    this.meshIndex = null
    this.interaction = new InteractionEngine()
    this.quality = new AdaptiveQuality()

    this._scene = null          // THREE.Scene
    this._modelRoot = null      // normalized model group
    this._snapshot = null       // loaded snapshot
    this._camera = null         // active camera
    this._lights = []           // managed lights

    this._loaded = false
    this._visible = true        // iframe visibility tracking
    this._paused = false
  }

  // ─── Load from Snapshot ──────────────────────────────────────────────────

  /**
   * Initialize engine from a publish snapshot + loaded GLTF.
   * Call once after GLTF loads.
   *
   * @param {object} snapshot - Full publish snapshot JSON
   * @param {THREE.Object3D} gltfScene - Loaded gltf.scene
   * @param {THREE.Scene} threeScene - The Three.js scene
   * @param {THREE.Camera} camera
   */
  async initialize(snapshot, gltfScene, threeScene, camera) {
    this._snapshot = snapshot
    this._scene = threeScene
    this._camera = camera

    // Step 6: Apply normalization
    const importConfig = snapshot.import
    const norm = importConfig?.normalization ?? (importConfig?.combinedScale ? importConfig : null)
    if (norm) {
      this._modelRoot = applyNormalization(gltfScene, norm)
    } else {
      this._modelRoot = gltfScene
    }
    threeScene.add(this._modelRoot)

    // Force full world matrix update after adding to scene + normalization
    this._modelRoot.updateWorldMatrix(true, true)

    // Step 7–8: Index meshes, apply materials
    const { registry, meshIndex, report } = buildPartRegistry(
      this._modelRoot,
      { parts: snapshot.parts ?? [] },
      { autoDetect: true, verbose: false },
    )
    this.registry = registry
    this.meshIndex = meshIndex

    if (snapshot.materials?.length) {
      applyMaterials(meshIndex, snapshot.materials, snapshot.reflection?.intensity ?? 1.0)
    }
    applyAutomotiveMaterialTuning(this._modelRoot, {
      reflectionIntensity: snapshot.stage?.environmentIntensity ?? snapshot.reflection?.intensity ?? 1.18,
      shadows: snapshot.stage?.shadows ?? snapshot.platform?.enabled ?? true,
    })

    // Step 11: Build lighting from snapshot
    this._applyLighting(snapshot.lighting)

    // Step 14: Apply camera config
    if (snapshot.camera?.autoFit && snapshot.import?.boundingBoxNormalized) {
      const bbox = snapshot.import.boundingBoxNormalized
      const size = {
        width: bbox.max[0] - bbox.min[0],
        height: bbox.max[1] - bbox.min[1],
        depth: bbox.max[2] - bbox.min[2],
      }
      const fit = computeAutoFitCamera(size, snapshot.camera.fov ?? 40)
      camera.position.set(...fit.position)
      camera.near = fit.near
      camera.far = fit.far
      camera.updateProjectionMatrix()
    } else if (snapshot.camera?.position) {
      camera.position.set(...snapshot.camera.position)
    }

    // Apply quality preset
    if (snapshot.performance?.preset) {
      // Quality is managed via AdaptiveQuality per frame
    }

    this._loaded = true
    return report
  }

  // ─── Per-Frame Update ─────────────────────────────────────────────────────

  /**
   * Call from useFrame: engine.update(delta, clock.elapsedTime)
   * @param {number} dt - Delta time (seconds)
   * @param {number} time - Elapsed time (seconds)
   */
  update(dt, time) {
    if (!this._loaded || this._paused || !this._visible) return

    // Adaptive quality
    this.quality.update(dt)

    // Run interaction engine
    if (this.registry) {
      this.interaction.update(this.registry, dt, time)
    }
  }

  // ─── Interaction API ─────────────────────────────────────────────────────

  /** @param {string} partId */
  open(partId) { this.interaction.open(partId) }
  /** @param {string} partId */
  close(partId) { this.interaction.close(partId) }
  /** @param {string} partId */
  toggle(partId) { this.interaction.toggle(partId) }
  /** @param {string} partId @param {string} hex */
  setColor(partId, hex) { this.interaction.setColor(partId, hex) }
  /** @param {string} partId @param {'open'|'closed'|'on'|'off'} state */
  setState(partId, state) { this.interaction.setState(partId, state) }
  /** @param {string} partId @param {number} speed */
  setSpin(partId, speed) { this.interaction.setSpin(partId, speed) }

  toggleLights(forceState = null) {
    if (!this.registry) return false
    const lights = this.registry.lights
    if (lights.length === 0) return false
    const shouldTurnOn = forceState ?? lights.some((part) => part.targetState !== 'on')
    for (const part of lights) {
      this.interaction.setState(part.id, shouldTurnOn ? 'on' : 'off')
    }
    return shouldTurnOn
  }

  toggleHeadlights(forceState = null) {
    if (!this.registry) return false
    const lights = this.registry.headLights.length > 0 ? this.registry.headLights : this.registry.lights
    if (lights.length === 0) return false
    const shouldTurnOn = forceState ?? lights.some((part) => part.targetState !== 'on')
    for (const part of lights) {
      this.interaction.setState(part.id, shouldTurnOn ? 'on' : 'off')
    }
    return shouldTurnOn
  }

  setWheelSpin(enabledOrSpeed = true, speed = 5.5) {
    if (!this.registry) return false
    const parts = this.registry.wheelSpinParts
    if (parts.length === 0) return false
    const enabled = typeof enabledOrSpeed === 'number' ? enabledOrSpeed !== 0 : !!enabledOrSpeed
    const spinSpeed = typeof enabledOrSpeed === 'number' ? enabledOrSpeed : speed
    for (const part of parts) {
      this.interaction.setSpin(part.id, enabled ? spinSpeed : 0)
    }
    return enabled
  }

  /**
   * Handle raycaster hit — toggle or open the clicked part.
   * @param {THREE.Mesh} mesh
   * @returns {import('./part-registry.js').PartEntry | null}
   */
  onMeshClick(mesh) {
    if (!this.registry) return null
    // Find part that owns this mesh
    for (const part of this.registry.interactive) {
      if (part.meshObjects.includes(mesh)) {
        this.toggle(part.id)
        return part
      }
    }
    return null
  }

  // ─── Visibility / Pause ──────────────────────────────────────────────────

  /** Pause rendering when iframe is off-screen */
  pause() { this._paused = true }
  resume() { this._paused = false }
  setVisible(v) { this._visible = v }

  // ─── Lighting ────────────────────────────────────────────────────────────

  _applyLighting(lightingConfig) {
    if (!this._scene) return
    const config = lightingConfig || {
      ambient: { enabled: true, color: '#ffffff', intensity: 0.35 },
      lights: [
        { type: 'directional', position: [4, 6, -4], intensity: 2.2, color: '#ffffff', castShadow: true },
        { type: 'directional', position: [-4, 3, 3], intensity: 0.8, color: '#dbeafe' },
        { type: 'directional', position: [0, 4, 6], intensity: 1.1, color: '#ffffff' },
      ],
    }

    // Clear previous engine-managed lights
    for (const l of this._lights) this._scene.remove(l)
    this._lights = []

    if (config.ambient?.enabled) {
      const al = new THREE.AmbientLight(
        config.ambient.color ?? '#ffffff',
        config.ambient.intensity ?? 0.35,
      )
      this._scene.add(al)
      this._lights.push(al)
    }

    for (const lc of (config.lights ?? [])) {
      let light
      if (lc.type === 'directional') {
        light = new THREE.DirectionalLight(lc.color ?? '#ffffff', lc.intensity ?? 1)
        if (lc.position) light.position.set(...lc.position)
        if (lc.target) light.target.position.set(...lc.target)
        light.castShadow = !!lc.castShadow
        if (lc.castShadow && lc.mapSize) {
          light.shadow.mapSize.setScalar(lc.mapSize)
          light.shadow.bias = lc.bias ?? -0.0001
          light.shadow.normalBias = lc.normalBias ?? 0.02
        }
      } else if (lc.type === 'point') {
        light = new THREE.PointLight(lc.color, lc.intensity, lc.distance, lc.decay ?? 2)
        if (lc.position) light.position.set(...lc.position)
      } else if (lc.type === 'spot') {
        light = new THREE.SpotLight(lc.color, lc.intensity)
        if (lc.position) light.position.set(...lc.position)
      }
      if (light) { this._scene.add(light); this._lights.push(light) }
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  dispose() {
    if (this._modelRoot && this._scene) this._scene.remove(this._modelRoot)
    for (const l of this._lights) this._scene?.remove(l)
    this.registry?.clear()
    this._loaded = false
  }
}
