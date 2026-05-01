import { updateSession } from './src/config/supabase/middleware.js'

export async function middleware(request) {
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|robots.txt|sw.js|workbox-.*\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
