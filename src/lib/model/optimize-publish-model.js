function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2)} MB`
}

export async function optimizePublishModelFile(file, {
  signal,
  onProgress,
  options = {},
} = {}) {
  if (!file || !/\.(glb|gltf)$/i.test(file.name)) return { file, metadata: null, optimized: false }
  if (typeof Worker === 'undefined') return { file, metadata: null, optimized: false }

  const buffer = await file.arrayBuffer()
  const worker = new Worker(new URL('../../workers/asset-optimizer.worker.js', import.meta.url), {
    type: 'module',
  })

  try {
    return await new Promise((resolve, reject) => {
      let settled = false

      const settle = (fn, value) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        worker.terminate()
        fn(value)
      }

      const abort = () => {
        worker.postMessage({ type: 'CANCEL' })
        settle(reject, new DOMException('Model optimization cancelled.', 'AbortError'))
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
            phase: 'optimizing',
            fileName: file.name,
            totalBytes: file.size,
            uploadedBytes: 0,
            percent: Math.max(1, Math.min(99, Math.round((message.progress || 0) * 100))),
            totalParts: 0,
            completedParts: 0,
            currentPart: null,
            statusText: message.message || 'Optimizing model',
            parts: [],
          })
          return
        }

        if (message.type === 'PUBLISH_MODEL_READY') {
          const optimizedFile = new File([message.blob], message.fileName || file.name, {
            type: message.blob.type || 'model/gltf-binary',
          })
          const metadata = {
            ...(message.metadata ?? {}),
            originalFileName: file.name,
            optimizedFileName: optimizedFile.name,
          }
          const savings = metadata.originalBytes && metadata.optimizedBytes
            ? Math.max(0, Math.round((1 - metadata.optimizedBytes / metadata.originalBytes) * 100))
            : 0

          onProgress?.({
            phase: 'optimized',
            fileName: optimizedFile.name,
            totalBytes: optimizedFile.size,
            uploadedBytes: 0,
            percent: 100,
            totalParts: 0,
            completedParts: 0,
            currentPart: null,
            statusText: savings > 0
              ? `Optimized ${formatBytes(metadata.originalBytes)} -> ${formatBytes(metadata.optimizedBytes)} (${savings}% smaller)`
              : 'Optimized model ready',
            parts: [],
          })

          settle(resolve, { file: optimizedFile, metadata, optimized: true })
          return
        }

        if (message.type === 'ERROR') {
          settle(reject, new Error(message.error || 'Model optimization failed.'))
        }
      }

      worker.onerror = (event) => {
        settle(reject, new Error(event.message || 'Model optimization worker crashed.'))
      }

      worker.postMessage({
        type: 'PROCESS_PUBLISH_MODEL',
        fileName: file.name,
        buffer,
        options: {
          textureMode: options.textureMode || 'webp',
          maxTextureSize: options.maxTextureSize || 2048,
        },
      }, [buffer])
    })
  } catch (err) {
    onProgress?.({
      phase: 'optimizing',
      fileName: file.name,
      totalBytes: file.size,
      uploadedBytes: 0,
      percent: 0,
      totalParts: 0,
      completedParts: 0,
      currentPart: null,
      statusText: `Optimization skipped: ${err.message}`,
      parts: [],
    })
    return { file, metadata: { skipped: true, reason: err.message }, optimized: false }
  } finally {
    worker.terminate()
  }
}
