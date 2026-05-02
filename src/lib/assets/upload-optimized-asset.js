import { getExpectedAssetFiles } from './lod-profiles.js'

function xhrUpload(url, blob, contentType, { signal, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    const abort = () => {
      xhr.abort()
      reject(new DOMException('Upload cancelled.', 'AbortError'))
    }

    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })

    xhr.open('PUT', url, true)
    xhr.setRequestHeader('Content-Type', contentType || blob.type || 'application/octet-stream')

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return
      onProgress?.({
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      })
    })

    xhr.addEventListener('load', () => {
      signal?.removeEventListener('abort', abort)
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Upload failed with HTTP ${xhr.status}.`))
      }
    })

    xhr.addEventListener('error', () => {
      signal?.removeEventListener('abort', abort)
      reject(new Error('Network error during upload.'))
    })

    xhr.addEventListener('abort', () => {
      signal?.removeEventListener('abort', abort)
    })

    xhr.send(blob)
  })
}

export async function uploadOptimizedAsset(file, {
  signal,
  onProgress,
  options = {},
} = {}) {
  const files = getExpectedAssetFiles({
    includeOriginal: Boolean(options.generateOriginalBackup),
  })
  const initRes = await fetch('/api/assets/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      files,
    }),
    signal,
  })
  const init = await initRes.json()
  if (!initRes.ok) throw new Error(init.error || 'Could not initialize asset upload.')

  const buffer = await file.arrayBuffer()
  const worker = new Worker(new URL('../../workers/asset-optimizer.worker.js', import.meta.url), {
    type: 'module',
  })
  const uploads = new Set()
  let finalManifest = null

  const cleanup = () => {
    worker.terminate()
  }

  try {
    return await new Promise((resolve, reject) => {
      let settled = false

      const settle = (fn, value) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        fn(value)
      }

      const abort = () => {
        worker.postMessage({ type: 'CANCEL' })
        settle(reject, new DOMException('Asset upload cancelled.', 'AbortError'))
      }

      if (signal?.aborted) {
        abort()
        return
      }
      signal?.addEventListener('abort', abort, { once: true })

      worker.onmessage = (event) => {
        const message = event.data

        if (message.type === 'PROGRESS') {
          onProgress?.({
            type: 'worker',
            stage: message.stage,
            progress: message.progress,
            message: message.message,
          })
          return
        }

        if (message.type === 'FILE_READY') {
          const uploadUrl = init.uploadUrls[message.fileKey]
          if (!uploadUrl) {
            settle(reject, new Error(`No upload URL for ${message.fileKey}.`))
            return
          }

          const upload = xhrUpload(uploadUrl, message.blob, message.blob.type, {
            signal,
            onProgress: (progress) => {
              onProgress?.({
                type: 'upload',
                fileKey: message.fileKey,
                metadata: message.metadata,
                ...progress,
              })
            },
          }).finally(() => {
            uploads.delete(upload)
          })

          uploads.add(upload)
          return
        }

        if (message.type === 'DONE') {
          finalManifest = message.manifest
          Promise.all([...uploads])
            .then(async () => {
              const finalizeRes = await fetch('/api/assets/finalize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  assetId: init.assetId,
                  manifest: finalManifest,
                }),
                signal,
              })
              const finalize = await finalizeRes.json()
              if (!finalizeRes.ok) throw new Error(finalize.error || 'Could not finalize asset.')
              settle(resolve, { assetId: init.assetId, manifest: finalManifest })
            })
            .catch((err) => settle(reject, err))
          return
        }

        if (message.type === 'ERROR') {
          settle(reject, new Error(message.error || 'Asset worker failed.'))
        }
      }

      worker.onerror = (event) => {
        settle(reject, new Error(event.message || 'Asset worker crashed.'))
      }

      worker.postMessage({
        type: 'PROCESS_ASSET',
        assetId: init.assetId,
        fileName: file.name,
        buffer,
        publicUrls: init.publicUrls,
        options: {
          geometryCompression: options.geometryCompression || 'meshopt',
          textureMode: options.textureMode || 'webp',
          generateOriginalBackup: Boolean(options.generateOriginalBackup),
          lodProfile: options.lodProfile || 'auto',
        },
      }, [buffer])
    })
  } finally {
    cleanup()
  }
}
