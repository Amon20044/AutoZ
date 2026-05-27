import { updateSession } from './src/config/supabase/middleware.js'

export async function proxy(request) {
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|robots.txt|sw.js|workbox-.*\\.js|demo/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|glb|gltf|bin|hdr|exr|ktx|ktx2|json)$).*)',
  ],
}
