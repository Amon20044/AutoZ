/**
 * ImgBB API v1 Configuration & Upload Client
 *
 * Server-only module. Handles uploading base64-encoded images to ImgBB.
 * Used for image-like visual assets: thumbnails, previews, material swatches.
 *
 * @see https://api.imgbb.com/
 */

if (typeof window !== 'undefined') {
  throw new Error('ImgBB config is server-only. Do not import src/config/imgbb.js from client components.')
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload'

const getApiKey = () => {
  const key = process.env.IMGBB_API_KEY?.trim()

  if (!key) {
    throw new Error(
      'Missing required environment variable: IMGBB_API_KEY. ' +
        'Get your free API key at https://api.imgbb.com/',
    )
  }

  return key
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Upload a base64-encoded image to ImgBB.
 *
 * @param {string} base64Image - Base64-encoded image data (no data-uri prefix).
 * @param {object} [options]
 * @param {string} [options.name] - Display name for the image on ImgBB.
 * @param {number} [options.expiration] - Auto-delete after N seconds (optional).
 * @returns {Promise<ImgBBUploadResult>}
 *
 * @typedef {object} ImgBBUploadResult
 * @property {string} id         - ImgBB image ID.
 * @property {string} url        - Direct image URL (full size).
 * @property {string} displayUrl - Display-friendly URL.
 * @property {string} deleteUrl  - URL to delete the image.
 * @property {string} thumbUrl   - Thumbnail URL.
 * @property {string} mediumUrl  - Medium-sized URL (if available).
 * @property {number} width      - Image width in pixels.
 * @property {number} height     - Image height in pixels.
 * @property {number} size       - File size in bytes.
 * @property {string} mime       - MIME type.
 * @property {string} title      - Image title on ImgBB.
 */
export async function uploadToImgBB(base64Image, options = {}) {
  const apiKey = getApiKey()

  // Strip data-URI prefix if present
  const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '')

  // Build form body
  const formData = new FormData()
  formData.append('key', apiKey)
  formData.append('image', cleanBase64)

  if (options.name) {
    formData.append('name', options.name)
  }

  if (options.expiration && Number.isFinite(options.expiration)) {
    formData.append('expiration', String(options.expiration))
  }

  const response = await fetch(IMGBB_UPLOAD_URL, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`ImgBB upload failed (${response.status}): ${errorText}`)
  }

  const json = await response.json()

  if (!json.success) {
    throw new Error(`ImgBB upload rejected: ${JSON.stringify(json.error || json)}`)
  }

  const { data } = json

  return {
    id: data.id,
    url: data.url,
    displayUrl: data.display_url,
    deleteUrl: data.delete_url,
    thumbUrl: data.thumb?.url ?? data.url,
    mediumUrl: data.medium?.url ?? data.url,
    width: data.width,
    height: data.height,
    size: data.size,
    mime: data.image?.mime ?? 'image/webp',
    title: data.title,
  }
}

// ---------------------------------------------------------------------------
// Convenience: Upload a Buffer directly (converts to base64 internally)
// ---------------------------------------------------------------------------

/**
 * Upload a raw image buffer to ImgBB.
 * Internally converts to base64 before uploading.
 *
 * @param {Buffer} buffer - Raw image bytes (should ideally be WebP).
 * @param {object} [options] - Same options as uploadToImgBB.
 * @returns {Promise<ImgBBUploadResult>}
 */
export async function uploadBufferToImgBB(buffer, options = {}) {
  const base64 = Buffer.from(buffer).toString('base64')
  return uploadToImgBB(base64, options)
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { IMGBB_UPLOAD_URL }

export default { uploadToImgBB, uploadBufferToImgBB, IMGBB_UPLOAD_URL }
