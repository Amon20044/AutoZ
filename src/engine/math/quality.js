/**
 * @module engine/math/quality
 * Adaptive quality: DPR scaling, FPS monitoring, quality presets.
 */

/** Quality presets from the PRD */
export const QUALITY_PRESETS = Object.freeze({
  low: { dpr: [1, 1], textureMax: 1024, shadows: false, contactShadowRes: 256, postProcessing: false, envRes: 512 },
  medium: { dpr: [1, 1.25], textureMax: 1024, shadows: true, contactShadowRes: 512, postProcessing: false, envRes: 1024 },
  high: { dpr: [1, 1.75], textureMax: 2048, shadows: true, contactShadowRes: 1024, postProcessing: true, envRes: 2048 },
})

/**
 * Adaptive quality controller.
 * Adjusts quality factor q ∈ [0,1] based on measured FPS.
 *
 * q_next = clamp(q ± δ) based on fps vs target
 * DPR = DPR_min + q·(DPR_max − DPR_min)
 */
export class AdaptiveQuality {
  constructor({ targetFPS = 55, minQ = 0, maxQ = 1, delta = 0.05, dprRange = [1, 1.75] } = {}) {
    this.targetFPS = targetFPS
    this.minQ = minQ
    this.maxQ = maxQ
    this.delta = delta
    this.dprRange = dprRange
    this.q = maxQ
    this._fpsSamples = []
    this._sampleWindow = 30 // frames
  }

  /** Record a frame's FPS sample */
  sample(fps) {
    this._fpsSamples.push(fps)
    if (this._fpsSamples.length > this._sampleWindow) this._fpsSamples.shift()
  }

  /** Current average FPS */
  get avgFPS() {
    if (!this._fpsSamples.length) return 60
    return this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length
  }

  /** Call per frame with dt. Returns current DPR. */
  update(dt) {
    if (dt > 0) this.sample(1 / dt)
    const avg = this.avgFPS
    if (avg < this.targetFPS - 5) {
      this.q = Math.max(this.minQ, this.q - this.delta)
    } else if (avg > this.targetFPS + 3) {
      this.q = Math.min(this.maxQ, this.q + this.delta * 0.5) // recover slower
    }
    return this.dpr
  }

  get dpr() {
    return this.dprRange[0] + this.q * (this.dprRange[1] - this.dprRange[0])
  }

  get preset() {
    if (this.q < 0.33) return 'low'
    if (this.q < 0.66) return 'medium'
    return 'high'
  }
}
