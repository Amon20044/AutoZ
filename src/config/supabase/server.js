import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { getSupabaseEnv } from './config.js'

export const createClient = (cookieStore = cookies()) => {
  const { supabaseUrl, supabasePublishableKey } = getSupabaseEnv()

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Server Components cannot write cookies. Middleware refreshes sessions and applies cookie updates.
        }
      },
    },
  })
}

export default createClient
