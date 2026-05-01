import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

import { getSupabaseEnv } from './config.js'

export const updateSession = async (request) => {
  const { supabaseUrl, supabasePublishableKey } = getSupabaseEnv()

  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))

        supabaseResponse = NextResponse.next({
          request,
        })

        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options)
        })
      },
    },
  })

  await supabase.auth.getClaims()

  return supabaseResponse
}
