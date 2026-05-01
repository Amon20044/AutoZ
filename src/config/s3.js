import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { env } from './env.js'

if (typeof window !== 'undefined') {
  throw new Error('S3 config is server-only. Do not import src/config/s3.js from client components.')
}

export const MODELS_BUCKET = env.s3.modelsBucket

// Server-only Supabase Storage S3 client.
// Use this only for storing and reading 3D model files in the Models bucket.
// These access keys have broad storage access and must never be exposed to the browser.
export const s3Client = new S3Client({
  forcePathStyle: true,
  region: env.s3.region,
  endpoint: env.s3.endpoint,
  credentials: {
    accessKeyId: env.s3.accessKeyId,
    secretAccessKey: env.s3.secretAccessKey,
  },
})

export const verifyModelsBucketConnection = async () => {
  await s3Client.send(new HeadBucketCommand({ Bucket: MODELS_BUCKET }))

  return true
}

export default s3Client
