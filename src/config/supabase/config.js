const requiredSupabaseEnvKeys = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']

const supabaseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
}

const readRequiredEnv = (key) => {
  const value = supabaseEnv[key]?.trim()

  if (!value) {
    throw new Error(`Missing required Supabase environment variable: ${key}`)
  }

  return value
}

export const getSupabaseEnv = () => ({
  supabaseUrl: readRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
  supabasePublishableKey: readRequiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
})

export const assertSupabaseEnv = () => {
  requiredSupabaseEnvKeys.forEach(readRequiredEnv)
}
