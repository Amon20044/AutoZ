import { NextResponse } from 'next/server'
import { updateSession } from './src/config/supabase/middleware.js'

const STATIC_EXTENSIONS = new Set([
  '.glb', '.gltf', '.bin', '.hdr', '.exr', '.ktx', '.ktx2',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico',
  '.json', '.txt', '.xml', '.map',
  '.js', '.css', '.woff', '.woff2', '.ttf', '.otf',
  '.mp4', '.webm', '.mp3', '.wav', '.ogg',
])

function isStaticAsset(pathname) {
  // /demo/* is the landing demo's static config bucket. Anything under /icons
  // or with a known file extension is a passthrough — the Supabase session
  // refresh middleware shouldn't touch these.
  if (pathname.startsWith('/demo/')) return true
  if (pathname.startsWith('/icons/')) return true
  if (pathname.startsWith('/encoders/')) return true
  if (pathname.startsWith('/img/')) return true
  if (pathname.startsWith('/_next/')) return true
  const dot = pathname.lastIndexOf('.')
  if (dot === -1) return false
  const ext = pathname.slice(dot).toLowerCase()
  return STATIC_EXTENSIONS.has(ext)
}

export async function proxy(request) {
  if (isStaticAsset(request.nextUrl.pathname)) {
    return NextResponse.next()
  }
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
