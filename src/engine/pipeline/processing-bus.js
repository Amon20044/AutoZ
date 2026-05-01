/**
 * @module engine/pipeline/processing-bus
 * Tiny typed EventEmitter for streaming pipeline progress events.
 * No dependencies — works in browser and server.
 *
 * Usage:
 *   import { processingBus } from '@/engine/pipeline/processing-bus'
 *   processingBus.on('step', handler)
 *   processingBus.emit('step', { ... })
 */

class ProcessingBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map()
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set())
    this._listeners.get(event).add(fn)
    return () => this.off(event, fn) // returns unsubscribe fn
  }

  off(event, fn) {
    this._listeners.get(event)?.delete(fn)
  }

  emit(event, payload) {
    this._listeners.get(event)?.forEach((fn) => fn(payload))
  }

  once(event, fn) {
    const wrapper = (payload) => { fn(payload); this.off(event, wrapper) }
    return this.on(event, wrapper)
  }

  clear() { this._listeners.clear() }
}

/** Singleton bus shared across the import pipeline */
export const processingBus = new ProcessingBus()

// ─── Step IDs ────────────────────────────────────────────────────────────────

export const PIPELINE_STEPS = Object.freeze({
  VALIDATE:   'validate',
  PARSE:      'parse',
  NORMALIZE:  'normalize',
  DETECT:     'detect',
  MATERIALS:  'materials',
  READY:      'ready',
  ERROR:      'error',
})

/**
 * Emit a step event.
 * @param {string} stepId - One of PIPELINE_STEPS
 * @param {string} label - Human-readable label
 * @param {'running'|'done'|'error'} status
 * @param {string} [detail] - Extra detail text
 * @param {object} [data] - Structured data for the log
 * @param {number} [startTime] - Pipeline start timestamp for elapsed calc
 */
export function emitStep(stepId, label, status, detail = '', data = null, startTime = Date.now()) {
  processingBus.emit('step', {
    id: stepId,
    label,
    status,
    detail,
    data,
    elapsed: Date.now() - startTime,
    timestamp: Date.now(),
  })
}
