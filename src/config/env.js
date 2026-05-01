const requiredEnvKeys = [
  'S3_URL',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_MODELS_BUCKET',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'DATABASE_URL',
  'DIRECT_URL',
  'IMGBB_API_KEY',
]

const readRequiredEnv = (key) => {
  const value = process.env[key]?.trim()

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }

  return value
}

export const initEnv = () => ({
  s3: {
    endpoint: readRequiredEnv('S3_URL'),
    region: readRequiredEnv('S3_REGION'),
    accessKeyId: readRequiredEnv('S3_ACCESS_KEY_ID'),
    secretAccessKey: readRequiredEnv('S3_SECRET_ACCESS_KEY'),
    modelsBucket: readRequiredEnv('S3_MODELS_BUCKET'),
  },
  supabase: {
    url: readRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    publishableKey: readRequiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  },
  database: {
    url: readRequiredEnv('DATABASE_URL'),
    directUrl: readRequiredEnv('DIRECT_URL'),
  },
  imgbb: {
    apiKey: readRequiredEnv('IMGBB_API_KEY'),
  },
})

export const assertRequiredEnv = () => {
  requiredEnvKeys.forEach(readRequiredEnv)
}

export const env = initEnv()
