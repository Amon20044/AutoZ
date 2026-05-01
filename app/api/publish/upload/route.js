/**
 * POST /api/publish/upload
 *
 * Streaming model upload proxy.
 *
 * The client sends the raw model binary as the request body
 * (Content-Type: model/gltf-binary or application/octet-stream).
 * We pipe it directly into an S3 multipart upload WITHOUT buffering
 * the entire file in Node.js memory.
 *
 * Query params:
 *   slug        - publish ID (e.g. az-b9af07e175)
 *   fileName    - original file name (e.g. lamborghini.glb)
 *   fileSize    - total byte size (for the response / logging)
 *   contentType - MIME type (optional, defaults to model/gltf-binary)
 *
 * Response (JSON):
 *   { publicUrl, key, size }
 *
 * This avoids both the CORS limitation of presigned PUT URLs
 * and the memory exhaustion of `request.formData()` for large files.
 */

import { NextResponse } from 'next/server'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { s3Client, MODELS_BUCKET } from '@/config/s3'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PART_SIZE = 8 * 1024 * 1024        // 8 MB per part (S3 minimum is 5 MB)
const MAX_PARTS = 10_000
const PART_CONCURRENCY = 3
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

function getPublicStorageUrl(key) {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
  return `${base}/storage/v1/object/public/${MODELS_BUCKET}/${key}`
}

function sanitizePath(raw) {
  return String(raw ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .map((p) => p.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'asset')
    .join('/') || 'model.glb'
}

function guessMime(path, hint) {
  if (hint && hint !== 'application/octet-stream') return hint
  const ext = (path ?? '').split('.').pop()?.toLowerCase()
  return (
    { glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream' }[ext]
    || 'model/gltf-binary'
  )
}

export async function POST(request) {
  try {
    const url = new URL(request.url)
    const slug = url.searchParams.get('slug')
    const fileName = url.searchParams.get('fileName') || 'model.glb'
    const fileSize = parseInt(url.searchParams.get('fileSize') || '0', 10)
    const contentTypeHint = url.searchParams.get('contentType') || ''

    if (!slug) {
      return NextResponse.json({ error: 'Missing required query param: slug' }, { status: 400 })
    }

    const safePath = sanitizePath(fileName)
    const key = `models/${slug}/${safePath}`
    const contentType = guessMime(safePath, contentTypeHint)

    if (!request.body) {
      return NextResponse.json({ error: 'Request body is empty' }, { status: 400 })
    }

    // ─── Multipart upload driven by the request stream ────────────────────
    const createResult = await s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: MODELS_BUCKET,
        Key: key,
        ContentType: contentType,
        CacheControl: CACHE_CONTROL,
      }),
    )
    const uploadId = createResult.UploadId
    if (!uploadId) throw new Error('Storage did not return a multipart upload ID.')

    const completedParts = []

    try {
      // Buffer stream into fixed 8 MB parts and upload each as an S3 part.
      // Web streams can yield arbitrarily large chunks, so each incoming value
      // must be sliced instead of flushed whole once it crosses PART_SIZE.
      const reader = request.body.getReader()
      let partNumber = 0
      let chunkBuffer = [] // array of Uint8Array pieces
      let chunkSize = 0
      const inFlight = new Set() // pending UploadPartCommand promises
      let uploadError = null

      const uploadChunk = async (partNum, body) => {
        const result = await s3Client.send(
          new UploadPartCommand({
            Bucket: MODELS_BUCKET,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNum,
            Body: body,
            ContentLength: body.length,
          }),
        )
        if (!result.ETag) throw new Error(`No ETag returned for part ${partNum}.`)
        return { PartNumber: partNum, ETag: result.ETag }
      }

      const flushChunk = async () => {
        if (chunkSize <= 0) return

        partNumber += 1
        if (partNumber > MAX_PARTS) throw new Error('File too large — exceeds maximum S3 part limit.')

        // Concatenate chunk pieces into a single Buffer
        const body = Buffer.concat(chunkBuffer.map((u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)))
        chunkBuffer = []
        chunkSize = 0

        const pn = partNumber
        const promise = uploadChunk(pn, body).then(
          (part) => {
            completedParts.push(part)
          },
          (err) => {
            uploadError = err
            throw err
          },
        )
        inFlight.add(promise)
        promise
          .finally(() => {
            inFlight.delete(promise)
          })
          .catch(() => {
            // The rejection is stored in uploadError and re-thrown by the main flow.
          })

        // Throttle concurrency: wait until a slot is free
        if (inFlight.size >= PART_CONCURRENCY) {
          await Promise.race(inFlight)
          if (uploadError) throw uploadError
        }
      }

      const appendStreamChunk = async (value) => {
        let offset = 0

        while (offset < value.byteLength) {
          const remainingInPart = PART_SIZE - chunkSize
          const remainingInValue = value.byteLength - offset
          const take = Math.min(remainingInPart, remainingInValue)

          chunkBuffer.push(value.subarray(offset, offset + take))
          chunkSize += take
          offset += take

          if (chunkSize === PART_SIZE) {
            await flushChunk()
          }
        }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        if (uploadError) throw uploadError
        await appendStreamChunk(value)
      }

      // Flush remaining data as the final part
      if (uploadError) throw uploadError
      if (chunkSize > 0) {
        await flushChunk()
      }

      // Wait for all in-flight uploads
      await Promise.all([...inFlight])
      if (uploadError) throw uploadError

      // Sort parts by number (S3 requires ordered part list)
      completedParts.sort((a, b) => a.PartNumber - b.PartNumber)

      await s3Client.send(
        new CompleteMultipartUploadCommand({
          Bucket: MODELS_BUCKET,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: completedParts },
        }),
      )
    } catch (err) {
      // Always abort the multipart upload on error to avoid zombie uploads
      try {
        await s3Client.send(
          new AbortMultipartUploadCommand({
            Bucket: MODELS_BUCKET,
            Key: key,
            UploadId: uploadId,
          }),
        )
      } catch (abortErr) {
        console.warn('[Upload] Failed to abort multipart upload:', abortErr.message)
      }
      throw err
    }

    const publicUrl = getPublicStorageUrl(key)
    console.log(`[Upload] ✓ ${key} (${(fileSize / 1024 / 1024).toFixed(1)} MB) → ${publicUrl}`)

    return NextResponse.json({ publicUrl, key, size: fileSize, path: safePath })
  } catch (err) {
    console.error('[Upload API] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
