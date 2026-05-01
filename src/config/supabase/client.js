import { createBrowserClient } from '@supabase/ssr'

import { getSupabaseEnv } from './config.js'

export const createClient = () => {
  const { supabaseUrl, supabasePublishableKey } = getSupabaseEnv()

  return createBrowserClient(supabaseUrl, supabasePublishableKey)
}

export default createClient
