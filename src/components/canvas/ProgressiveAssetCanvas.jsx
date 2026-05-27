'use client'

import { Suspense, useCallback, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { AdaptiveDpr, ContactShadows, Environment, OrbitControls, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import ProgressiveCarModel from './ProgressiveCarModel'
import FpsTracker from './FpsTracker'

function DemandOrbitControls() {
  const invalidate = useThree((state) => state.invalidate)

  return (
    <OrbitControls
      enableDamping
      dampingFactor={0.08}
      target={[0, 0.75, 0]}
      minDistance={2}
      maxDistance={18}
      onChange={invalidate}
    />
  )
}

export default function ProgressiveAssetCanvas({ manifest }) {
  const [firstVisible, setFirstVisible] = useState(false)
  const [firstProgress, setFirstProgress] = useState({ percent: 0 })
  const [debug, setDebug] = useState(null)
  const [fpsSample, setFpsSample] = useState({ fps: null, regression: 0 })

  const handleFirstProgress = useCallback((event) => {
    setFirstProgress((prev) => ({
      ...prev,
      ...event,
      percent: event.percent ?? prev.percent ?? 0,
    }))
  }, [])

  const handleFpsSample = useCallback((sample) => {
    setFpsSample((prev) => {
      if (
        prev.fps === sample.fps
        && Math.abs((prev.regression ?? 0) - (sample.regression ?? 0)) < 0.05
      ) {
        return prev
      }
      return sample
    })
  }, [])

  return (
    <div className='asset-viewer-shell'>
      <Canvas
        frameloop='demand'
        shadows
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        dpr={[1, 2]}
        style={{ width: '100%', height: '100%', background: '#05070d' }}
      >
        <PerspectiveCamera makeDefault fov={38} near={0.01} far={120} position={[5, 3, -7]} />
        <DemandOrbitControls />
        <AdaptiveDpr pixelated />
        <Environment preset='studio' background={false} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[5, 5, -4]} intensity={2.2} castShadow />
        <directionalLight position={[-5, 3, 4]} intensity={0.8} />

        <Suspense fallback={null}>
          <FpsTracker onSample={handleFpsSample} />
          <ProgressiveCarModel
            manifest={manifest}
            performanceRegression={fpsSample.regression}
            onFirstVisible={() => setFirstVisible(true)}
            onFirstProgress={handleFirstProgress}
            onDebugChange={setDebug}
          />
        </Suspense>

        <ContactShadows position={[0, -0.01, 0]} opacity={0.45} blur={1.7} far={7} resolution={512} frames={1} />
      </Canvas>

      {!firstVisible && (
        <div className='asset-first-load'>
          <div className='az-spinner' />
          <span>Loading first LOD</span>
          <div className='asset-first-load-progress'>
            <div className='az-progress-bar'>
              <span style={{ width: `${Math.max(0, Math.min(100, firstProgress.percent || 0))}%` }} />
            </div>
            <code>{firstProgress.percent || 0}%</code>
          </div>
        </div>
      )}

      {fpsSample.fps !== null && (
        <div className='frame-fps-badge' aria-label={`FPS ${fpsSample.fps}`}>
          {fpsSample.fps} FPS
        </div>
      )}

      {debug && (
        <div className='asset-debug-panel'>
          <div>LOD: {debug.currentLodId || 'loading'}</div>
          <div>Device: {debug.deviceProfile?.deviceClass} / {debug.deviceProfile?.gpuTier}</div>
          <div>Calls: {debug.renderer?.calls ?? 0}</div>
          <div>Tris: {debug.renderer?.triangles ?? 0}</div>
          <div>Textures: {debug.renderer?.textures ?? 0}</div>
          <div>Programs: {debug.renderer?.programs ?? 0}</div>
          <div>GPU est: {debug.renderer?.gpuMemoryEstimateMb ?? 0} MB</div>
          <div>Cache: {debug.cacheSize ?? 0}</div>
        </div>
      )}
    </div>
  )
}
