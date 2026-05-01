/**
 * Image → WebP Conversion Engine
 *
 * Server-only module that converts any supported image format to WebP
 * using sharp. This runs as a preprocessing step before uploading to ImgBB.
 *
 * Supported input formats:
 *   PNG, JPEG, JPG, BMP, GIF, TIFF, AVIF, WebP (re-optimized), SVG
 *
 * Output: Optimized WebP buffer with metadata.
 *
 * @see https://sharp.pixelplumbing.com/
 */

if (typeof window !== 'undefined') {
  throw new Error('Image conversion is server-only. Do not import src/lib/image/convert-to-webp.js from client components.')
}

import sharp from 'sharp'

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

/** @type {WebPConvertOptions} */
const DEFAULT_OPTIONS = {
  /** WebP quality (0–100). 80 is a good balance of size vs quality. */
  quality: 80,

  /** Maximum width in pixels. Images wider than this are downsized. */
  maxWidth: 2048,

  /** Maximum height in pixels. Images taller than this are downsized. */
  maxHeight: 2048,

  /** Use lossless WebP compression. false = lossy (smaller). */
  lossless: false,

  /**
   * sharp resize fit mode.
   * 'inside' = scale down to fit within maxWidth × maxHeight, preserving aspect ratio.
   */
  fit: 'inside',
}

// ---------------------------------------------------------------------------
// Core conversion function
// ---------------------------------------------------------------------------

/**
 * Convert an image buffer to an optimized WebP.
 *
 * @param {Buffer | ArrayBuffer | Uint8Array} input - Raw image bytes in any supported format.
 * @param {Partial<WebPConvertOptions>} [options] - Override default conversion settings.
 * @returns {Promise<WebPConvertResult>}
 *
 * @typedef {object} WebPConvertOptions
 * @property {number}  quality   - WebP quality (0–100).
 * @property {number}  maxWidth  - Max output width in px.
 * @property {number}  maxHeight - Max output height in px.
 * @property {boolean} lossless  - Use lossless WebP.
 * @property {string}  fit       - sharp resize fit mode.
 *
 * @typedef {object} WebPConvertResult
 * @property {Buffer} buffer     - Optimized WebP image bytes.
 * @property {number} width      - Final image width in px.
 * @property {number} height     - Final image height in px.
 * @property {number} size       - Buffer size in bytes.
 * @property {string} mimeType   - Always 'image/webp'.
 * @property {string} format     - Always 'webp'.
 * @property {object} original   - Metadata from the original input image.
 * @property {number} original.width
 * @property {number} original.height
 * @property {string} original.format
 * @property {number} original.size
 */
export async function convertToWebP(input, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Normalize input to Buffer
  const inputBuffer = Buffer.isBuffer(input) ? input : Buffer.from(input)

  // Read original metadata
  const originalMeta = await sharp(inputBuffer).metadata()

  // Build the sharp pipeline
  let pipeline = sharp(inputBuffer)

  // Resize only if the image exceeds max dimensions
  const needsResize =
    (originalMeta.width && originalMeta.width > opts.maxWidth) ||
    (originalMeta.height && originalMeta.height > opts.maxHeight)

  if (needsResize) {
    pipeline = pipeline.resize({
      width: opts.maxWidth,
      height: opts.maxHeight,
      fit: opts.fit,
      withoutEnlargement: true,
    })
  }

  // Convert to WebP
  pipeline = pipeline.webp({
    quality: opts.quality,
    lossless: opts.lossless,
    effort: 4, // compression effort (0–6), 4 is balanced
  })

  // Execute
  const result = await pipeline.toBuffer({ resolveWithObject: true })

  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
    size: result.info.size,
    mimeType: 'image/webp',
    format: 'webp',
    original: {
      width: originalMeta.width ?? 0,
      height: originalMeta.height ?? 0,
      format: originalMeta.format ?? 'unknown',
      size: inputBuffer.length,
    },
  }
}

// ---------------------------------------------------------------------------
// Convenience: Convert from a File/Blob (e.g., from FormData)
// ---------------------------------------------------------------------------

/**
 * Convert a File or Blob to WebP.
 *
 * @param {File | Blob} file - The uploaded file/blob.
 * @param {Partial<WebPConvertOptions>} [options]
 * @returns {Promise<WebPConvertResult>}
 */
export async function convertFileToWebP(file, options = {}) {
  const arrayBuffer = await file.arrayBuffer()
  return convertToWebP(Buffer.from(arrayBuffer), options)
}

// ---------------------------------------------------------------------------
// Convenience: Convert and return as base64 (ready for ImgBB)
// ---------------------------------------------------------------------------

/**
 * Convert an image to WebP and return the result as a base64 string.
 *
 * @param {Buffer | ArrayBuffer | Uint8Array} input
 * @param {Partial<WebPConvertOptions>} [options]
 * @returns {Promise<WebPConvertResult & { base64: string }>}
 */
export async function convertToWebPBase64(input, options = {}) {
  const result = await convertToWebP(input, options)

  return {
    ...result,
    base64: result.buffer.toString('base64'),
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export default { convertToWebP, convertFileToWebP, convertToWebPBase64, DEFAULT_OPTIONS }
