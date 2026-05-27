/**
 * Shared helpers for the demo + publish auth layers.
 *
 *   /editor/demo + /api/demo/config (writes)  → LOCALHOST-only.
 *      The landing demo is shipped as a static JSON file (public/demo/
 *      demo-config.json). It's edited on a developer's machine, saved
 *      via the editor, then committed to git. Vercel and any non-local
 *      host returns 403 with the git-workflow hint.
 *
 *   /api/publish                              → PLATFORM_TEST_KEY gate.
 *      The Publish modal in /editor sends `x-test-key`; the server
 *      validates against the env value with timing-safe equality.
 */
import { timingSafeEqual } from 'node:crypto'

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function isLocalhostHost(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader) return false
  const host = hostHeader.toLowerCase().split(':')[0]
  return LOCALHOST_HOSTS.has(host)
}

export function isLocalhostRequest(request) {
  return isLocalhostHost(request.headers.get('host'))
}

export function getPlatformTestKey() {
  const key = process.env.PLATFORM_TEST_KEY
  return typeof key === 'string' && key.length > 0 ? key : null
}

export function verifyTestKey(headerValue) {
  const expected = getPlatformTestKey()
  if (!expected) {
    return { ok: false, reason: 'Server is missing PLATFORM_TEST_KEY. Ask the platform admin to provision a tester key.' }
  }
  const provided = typeof headerValue === 'string' ? headerValue.trim() : ''
  if (!provided) return { ok: false, reason: 'Test key is required to publish.' }
  if (provided.length !== expected.length) return { ok: false, reason: 'Invalid test key.' }
  try {
    const ok = timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'))
    return ok ? { ok: true } : { ok: false, reason: 'Invalid test key.' }
  } catch {
    return { ok: false, reason: 'Invalid test key.' }
  }
}
