/**
 * @module engine/math/radial
 * 3D radial button positioning, constant-scale, world-to-screen projection.
 */
import * as THREE from 'three'

/**
 * Compute radial button world positions around an anchor point.
 * B_i = A + r_b·(cos(φ_i)·R_c + sin(φ_i)·U_c)
 *
 * @param {THREE.Vector3} anchor - Part anchor position (world)
 * @param {THREE.Vector3} cameraRight - Camera right vector
 * @param {THREE.Vector3} cameraUp - Camera up vector
 * @param {number} count - Number of buttons
 * @param {number} [radius=0.3] - Radial distance from anchor
 * @returns {THREE.Vector3[]} Button world positions
 */
export function computeRadialPositions(anchor, cameraRight, cameraUp, count, radius = 0.3) {
  const positions = []
  for (let i = 0; i < count; i++) {
    const phi = (2 * Math.PI * i) / count
    const pos = new THREE.Vector3()
      .addVectors(
        anchor,
        new THREE.Vector3()
          .addScaledVector(cameraRight, Math.cos(phi) * radius)
          .addScaledVector(cameraUp, Math.sin(phi) * radius),
      )
    positions.push(pos)
  }
  return positions
}

/**
 * Constant visual button scale regardless of camera distance.
 * scale = k · distance(camera, button) · tan(FOV/2)
 *
 * @param {THREE.Vector3} cameraPos
 * @param {THREE.Vector3} buttonPos
 * @param {number} fovDeg
 * @param {number} [k=0.035]
 * @returns {number}
 */
export function constantScale(cameraPos, buttonPos, fovDeg, k = 0.035) {
  const dist = cameraPos.distanceTo(buttonPos)
  return k * dist * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2)
}

/**
 * World → screen projection.
 * clip = P·V·M · [x,y,z,1]; ndc = clip.xyz / clip.w
 * screen_x = (ndc_x·0.5 + 0.5) · viewportWidth
 * screen_y = (−ndc_y·0.5 + 0.5) · viewportHeight
 *
 * @param {THREE.Vector3} worldPos
 * @param {THREE.Camera} camera
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 * @returns {{ x: number, y: number, depth: number, visible: boolean }}
 */
export function worldToScreen(worldPos, camera, viewportWidth, viewportHeight) {
  const ndc = worldPos.clone().project(camera)
  return {
    x: (ndc.x * 0.5 + 0.5) * viewportWidth,
    y: (-ndc.y * 0.5 + 0.5) * viewportHeight,
    depth: ndc.z,
    visible: ndc.z >= -1 && ndc.z <= 1,
  }
}

/**
 * Extract camera basis vectors (right, up, forward) from its world matrix.
 * @param {THREE.Camera} camera
 */
export function getCameraBasis(camera) {
  camera.updateMatrixWorld()
  const m = camera.matrixWorld.elements
  return {
    right: new THREE.Vector3(m[0], m[1], m[2]).normalize(),
    up: new THREE.Vector3(m[4], m[5], m[6]).normalize(),
    forward: new THREE.Vector3(-m[8], -m[9], -m[10]).normalize(),
  }
}
