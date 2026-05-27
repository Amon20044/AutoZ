import { NextResponse } from 'next/server'
import { updateSession } from './src/config/supabase/middleware.js'

const STATIC_EXTENSIONS = new Set([
  '.glb', '.gltf', '.bin', '.hdr', '.exr', '.ktx', '.ktx2',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico',
  '.json', '.txt', '.xml', '.map',
  '.js', '.css', '.woff', '.woff2', '.ttf', '.otf',
  '.mp4', '.webm', '.mp3', '.wav', '.ogg',
])

// Routes that never need a Supabase session refresh. The demo flow is
// localhost-gated and reads/writes a static JSON file — auth would only
// add latency and a failure mode if Supabase is unreachable.
const SESSION_BYPASS_PREFIXES = [
  '/demo/',
  '/icons/',
  '/encoders/',
  '/img/',
  '/_next/',
  '/editor/demo',
  '/frame/demo',
  '/api/demo/',
]

function isStaticAsset(pathname) {
  for (const prefix of SESSION_BYPASS_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix)) return true
  }
  const dot = pathname.lastIndexOf('.')
  if (dot === -1) return false
  const ext = pathname.slice(dot).toLowerCase()
  return STATIC_EXTENSIONS.has(ext)
}

// Hard timeout for the Supabase session refresh. Without this, a paused /
// unreachable Supabase instance hangs every page nav until the runtime kills
// the request (10s+). 1500ms is plenty for a healthy supabase.co round-trip,
// and lets dev keep moving when the DB is offline.
const SESSION_TIMEOUT_MS = 1500

async function safeUpdateSession(request) {
  try {
    return await Promise.race([
      updateSession(request),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('supabase-session-timeout')), SESSION_TIMEOUT_MS),
      ),
    ])
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[proxy] session refresh skipped: ${err.message}`)
    }
    return NextResponse.next({ request })
  }
}

export async function proxy(request) {
  if (isStaticAsset(request.nextUrl.pathname)) {
    return NextResponse.next()
  }
  return safeUpdateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
