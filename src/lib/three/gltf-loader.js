import { LoadingManager } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import {
  setDracoDecoderLocation,
  setKTX2TranscoderLocation,
  useNeedleProgressive as registerNeedleProgressive,
} from '@needle-tools/gltf-progressive'

export function createGltfLoader(renderer, { onProgress } = {}) {
  const manager = new LoadingManager()
  manager.onProgress = (_url, loaded, total) => {
    onProgress?.({ loaded, total, percent: total ? Math.round((loaded / total) * 100) : 0 })
  }

  const loader = new GLTFLoader(manager)
  setDracoDecoderLocation('/decoders/draco/')
  setKTX2TranscoderLocation('/decoders/basis/')

  const draco = new DRACOLoader()
  draco.setDecoderPath('/decoders/draco/')
  loader.setDRACOLoader(draco)
  loader.setMeshoptDecoder(MeshoptDecoder)

  if (renderer) {
    const ktx2 = new KTX2Loader()
    ktx2.setTranscoderPath('/decoders/basis/')
    ktx2.detectSupport(renderer)
    loader.setKTX2Loader(ktx2)
    registerNeedleProgressive(loader, renderer, {
      enableLODsManager: false,
      hints: { usecase: 'product' },
    })
  }

  return loader
}

export function loadGltf(url, renderer, { signal, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('GLTF load cancelled.', 'AbortError'))
      return
    }

    const loader = createGltfLoader(renderer, { onProgress })
    const abort = () => reject(new DOMException('GLTF load cancelled.', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })

    loader.load(
      url,
      (gltf) => {
        signal?.removeEventListener('abort', abort)
        resolve(gltf)
      },
      (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress?.({
            loaded: event.loaded,
            total: event.total,
            percent: Math.round((event.loaded / event.total) * 100),
          })
        }
      },
      (err) => {
        signal?.removeEventListener('abort', abort)
        reject(err)
      },
    )
  })
}
