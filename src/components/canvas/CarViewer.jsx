'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, Preload } from '@react-three/drei'
import * as THREE from 'three'

import StudioStage from './StudioStage'
import CarModel from './CarModel'
import PartButtons from './PartButtons'
import PostProcessing, { RendererSettings } from './PostProcessing'
import ImperativeMeshPicker from './ImperativeMeshPicker'
import CockpitLookControls from './CockpitLookControls'
import { installThreeConsoleFilter } from '@/lib/three/console-filter'
import { orbitTargetFromImport } from '@/lib/scene/orbit-target'
import { computeFrameCameraPreset } from '@/engine/math/camera'
import { dampVec3, stableDelta } from '@/engine/math/animation'
import { getDeviceProfile } from '@/hooks/useDeviceProfile'

installThreeConsoleFilter()

function attachContextRecovery(renderer, label) {
  const canvas = renderer?.domElement
  if (!canvas) return
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    console.warn(`[${label}] WebGL context lost — waiting for restore`)
  }, false)
  canvas.addEventListener('webglcontextrestored', () => {
    console.log(`[${label}] WebGL context restored`)
    try { renderer.forceContextRestore?.() } catch { /* ignore */ }
  }, false)
}

/**
 * Full 3D viewport canvas: assembles the studio scene.
 * Responds to sceneConfig changes from the right-side settings panel.
 */
export default function CarViewer({
  normalizedRoot,
  registry,
  interactionEngine,
  sceneStats,
  sceneConfig = {},
  onPartClick,
  onToggle,
  showPartLabels = true,
  activePartId = null,
}) {
  // Locked once at mount — see FrameCanvas for the why.
  const deviceCaps = useMemo(() => getDeviceProfile(null, 0), [])
  const parts = registry?.enabledInteractive ?? []
  const env = sceneConfig.environment ?? { preset: 'studio', background: false }
  const lighting = sceneConfig.lighting ?? {}
  const fog = sceneConfig.fog ?? { enabled: false }
  const stage = sceneConfig.stage ?? {}
  const animation = sceneConfig.animation ?? {}
  const cam = sceneConfig.camera ?? {}
  const post = sceneConfig.postprocessing ?? {}
  const backgroundColor = stage.backgroundColor ?? env.backgroundColor ?? '#f7f7f4'
  const reflectionIntensity = stage.environmentIntensity ?? 1.18
  const orbitTarget = useMemo(() => orbitTargetFromImport(sceneConfig.import, [0, 0.8, 0]), [sceneConfig.import])
  const controlsRef = useRef(null)
  const [frameInfo, setFrameInfo] = useState(null)
  const cameraMode = sceneConfig.camera?.frame?.selectedMode ?? 'auto'
  const editorPanEnabled = sceneConfig.camera?.frame?.editorPanEnabled !== false
  const isCockpit = cameraMode === 'cockpit'

  useEffect(() => {
    if (!normalizedRoot) {
      setFrameInfo(null)
      return
    }
    normalizedRoot.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(normalizedRoot)
    if (box.isEmpty()) {
      setFrameInfo(null)
      return
    }
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    setFrameInfo({
      center: center.toArray(),
      size: size.toArray(),
      radius: size.length() * 0.5,
    })
  }, [normalizedRoot])
  const handlePickedMesh = useMemo(() => (mesh) => {
    if (!registry) return false
    let target = mesh
    while (target && !target.isMesh) target = target.parent
    if (!target?.isMesh) return false

    for (const part of registry.enabledInteractive ?? []) {
      const owns = part.meshObjects?.some((m) => m === target || m?.uuid === target.uuid)
      if (owns) {
        onPartClick?.(part)
        return true
      }
    }
    return false
  }, [onPartClick, registry])

  return (
    <div className='az-viewport'>
      <div className={`az-viewport-device az-viewport-device--${sceneConfig.camera?.frame?.editorPreviewDevice ?? 'desktop'}`}>
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        gl={{
          antialias: deviceCaps.gpuTier !== 'low',
          alpha: false,
          powerPreference: deviceCaps.deviceClass === 'mobile' ? 'default' : 'high-performance',
          toneMapping: THREE.AgXToneMapping,
          toneMappingExposure: post.exposure ?? 1.1,
          outputColorSpace: THREE.SRGBColorSpace,
          preserveDrawingBuffer: false,
          failIfMajorPerformanceCaveat: false,
        }}
        dpr={[1, deviceCaps.maxDpr]}
        style={{ background: backgroundColor }}
        onCreated={({ gl }) => attachContextRecovery(gl, 'CarViewer')}
      >
        <PerspectiveCamera
          makeDefault
          fov={cam.fov ?? 40}
          near={0.01}
          far={100}
          position={cam.position ?? [5, 3, -7]}
        />

        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.1}
          minPolarAngle={isCockpit ? Math.PI / 2 : 0.3}
          maxPolarAngle={isCockpit ? Math.PI / 2 : Math.PI / 2 - 0.05}
          minDistance={0.05}
          maxDistance={12}
          enablePan={editorPanEnabled}
          panSpeed={0.55}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }}
          target={orbitTarget}
          enabled={!isCockpit}
          autoRotate={(animation.autoRotate ?? false) && (sceneConfig.camera?.frame?.selectedMode ?? 'auto') === 'auto'}
          autoRotateSpeed={animation.rotateSpeed ?? 0.35}
        />

        <EditorCameraRig
          mode={cameraMode}
          controlsRef={controlsRef}
          frameInfo={frameInfo}
          fallbackTarget={orbitTarget}
          cameraConfig={cam}
          rotateSpeed={animation.rotateSpeed ?? 0.35}
        />
        <CockpitLookControls
          enabled={isCockpit}
          frameInfo={frameInfo}
          fallbackTarget={orbitTarget}
          cameraConfig={cam}
          cameraSettings={cam.frame}
        />

        <RendererSettings exposure={post.exposure ?? 1.1} />
        <StudioStage environment={env} stage={stage} fog={fog} />

        <Suspense fallback={null}>
          <ConfigurableLights lighting={lighting} />

          {normalizedRoot && (
            <>
              <ImperativeMeshPicker
                enabled
                getRoots={() => [normalizedRoot]}
                onMesh={handlePickedMesh}
              />
              <CarModel
                normalizedRoot={normalizedRoot}
                registry={registry}
                interactionEngine={interactionEngine}
                onPartClick={onPartClick}
                renderSettings={{ reflectionIntensity, shadows: stage.shadows !== false }}
              />
              {showPartLabels && <PartButtons parts={parts} onToggle={onToggle} />}
              <PartPivotGizmo registry={registry} activePartId={activePartId} />
            </>
          )}
        </Suspense>

        <Preload all />
        {post.enabled !== false && deviceCaps.allowPostprocessing && (
          <PostProcessing config={post} tier={deviceCaps.gpuTier} deviceClass={deviceCaps.deviceClass} />
        )}
      </Canvas>
      </div>

      {sceneStats && (
        <div className='az-viewport-stats'>
          <div className='az-viewport-stat'>
            {Math.round(sceneStats.totalTris / 1000)}k tris
          </div>
          <div className='az-viewport-stat'>
            {sceneStats.meshCount} meshes
          </div>
          <div className='az-viewport-stat'>
            {sceneStats.uniqueMaterials} materials
          </div>
        </div>
      )}

      <div className='az-viewport-hint'>
        Drag to orbit - Shift drag to pan in editor - Scroll to zoom
      </div>
    </div>
  )
}

function EditorCameraRig({
  mode, controlsRef, frameInfo, fallbackTarget, cameraConfig, rotateSpeed = 0.35,
}) {
  const { camera, size } = useThree()
  const desired = useRef({
    position: new THREE.Vector3(...(cameraConfig?.position ?? [5, 3, -7])),
    target: new THREE.Vector3(...fallbackTarget),
    minDistance: 0.05,
    maxDistance: 12,
    autoRotateSpeed: 0.35,
  })
  const settleUntil = useRef(0)

  useEffect(() => {
    const preset = computeFrameCameraPreset({
      mode,
      frameInfo,
      fovDeg: cameraConfig?.fov ?? 40,
      aspect: size.width / Math.max(size.height, 1),
      isMobile: size.width <= 720,
      cameraSettings: cameraConfig?.frame,
    })
    desired.current.position.fromArray(preset.position)
    desired.current.target.fromArray(preset.target)
    desired.current.minDistance = preset.minDistance
    desired.current.maxDistance = preset.maxDistance
    desired.current.autoRotateSpeed = rotateSpeed
    settleUntil.current = performance.now() + 700

    const controls = controlsRef.current
    if (controls) {
      controls.minDistance = preset.minDistance
      controls.maxDistance = preset.maxDistance
      controls.enabled = mode !== 'cockpit'
      controls.autoRotate = mode === 'auto'
      controls.enablePan = cameraConfig?.frame?.editorPanEnabled !== false
      controls.minPolarAngle = mode === 'cockpit' ? Math.PI / 2 : 0.3
      controls.maxPolarAngle = mode === 'cockpit' ? Math.PI / 2 : Math.PI / 2 - 0.05
      controls.enableDamping = true
      controls.dampingFactor = 0.08
    }
  }, [cameraConfig?.fov, cameraConfig?.frame, controlsRef, fallbackTarget, frameInfo, mode, rotateSpeed, size.height, size.width])

  useFrame((_, rawDt) => {
    const controls = controlsRef.current
    const dt = stableDelta(rawDt)
    const settling = performance.now() < settleUntil.current

    if (controls) {
      controls.autoRotate = mode === 'auto'
      controls.enabled = mode !== 'cockpit'
      controls.enablePan = cameraConfig?.frame?.editorPanEnabled !== false
      controls.minPolarAngle = mode === 'cockpit' ? Math.PI / 2 : 0.3
      controls.maxPolarAngle = mode === 'cockpit' ? Math.PI / 2 : Math.PI / 2 - 0.05
      controls.minDistance = desired.current.minDistance
      controls.maxDistance = desired.current.maxDistance
      if (mode === 'auto') {
        const distance = camera.position.distanceTo(controls.target)
        const comfortableDistance = Math.max((frameInfo?.radius ?? 4) * 1.25, 1)
        const speedScale = THREE.MathUtils.clamp(distance / comfortableDistance, 0.18, 1)
        controls.autoRotateSpeed = rotateSpeed * speedScale
      }
      if (settling) {
        dampVec3(controls.target, desired.current.target, 16, dt)
      }
    }
    if (settling) {
      dampVec3(camera.position, desired.current.position, 16, dt)
    }

    const focus = controls?.target ?? desired.current.target
    const radius = Math.max(frameInfo?.radius ?? 4, 1)
    camera.near = 0.005
    camera.far = Math.max(80, camera.position.distanceTo(focus) + radius * 8)
    camera.updateProjectionMatrix()
  })

  return null
}

function getAxisColor(axis) {
  if (!axis) return '#00a3ff'
  const ax = Math.abs(axis.x)
  const ay = Math.abs(axis.y)
  const az = Math.abs(axis.z)
  if (ax >= ay && ax >= az) return '#ef4444'
  if (ay >= ax && ay >= az) return '#22c55e'
  return '#009dff'
}

function PartPivotGizmo({ registry, activePartId }) {
  const part = activePartId ? registry?.get?.(activePartId) : null

  const data = useMemo(() => {
    if (!part?.pivot || !part?.axis) return null

    const pivot = part.pivot.clone()
    const origin = part.origin?.clone?.() ?? pivot.clone()
    const axis = (part.spinAxis || part.axis).clone().normalize()
    const box = new THREE.Box3()
    for (const object of part.meshObjects ?? []) {
      object.updateWorldMatrix(true, false)
      box.expandByObject(object)
    }
    const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3())
    const length = Math.max(size.length() * 0.55, 0.55)
    const start = pivot.clone().addScaledVector(axis, -length)
    const end = pivot.clone().addScaledVector(axis, length)
    const axisGeometry = new THREE.BufferGeometry().setFromPoints([start, end])
    const offsetGeometry = new THREE.BufferGeometry().setFromPoints([origin, pivot])
    const dotScale = Math.max(length * 0.055, 0.045)

    return {
      pivot,
      origin,
      axisGeometry,
      offsetGeometry,
      axisColor: getAxisColor(axis),
      dotScale,
      hasOffset: origin.distanceToSquared(pivot) > 0.000001,
    }
  }, [part, part?.pivot?.x, part?.pivot?.y, part?.pivot?.z, part?.pivotOffset?.x, part?.pivotOffset?.y, part?.pivotOffset?.z])

  if (!data) return null

  return (
    <group renderOrder={20}>
      <line geometry={data.axisGeometry} frustumCulled={false} renderOrder={21}>
        <lineBasicMaterial
          color={data.axisColor}
          transparent
          opacity={0.95}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </line>

      {data.hasOffset && (
        <line geometry={data.offsetGeometry} frustumCulled={false} renderOrder={22}>
          <lineBasicMaterial
            color='#f59e0b'
            transparent
            opacity={0.75}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </line>
      )}

      <mesh position={data.origin} frustumCulled={false} renderOrder={23}>
        <sphereGeometry args={[data.dotScale * 0.68, 16, 16]} />
        <meshBasicMaterial
          color='#ffffff'
          transparent
          opacity={data.hasOffset ? 0.72 : 0.35}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <mesh position={data.pivot} frustumCulled={false} renderOrder={24}>
        <sphereGeometry args={[data.dotScale, 20, 20]} />
        <meshBasicMaterial
          color='#f97316'
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

function ConfigurableLights({ lighting }) {
  const ambient = lighting?.ambient ?? { enabled: true, intensity: 0.4 }
  const lights = lighting?.lights ?? []
  const lightIntensity = lighting?.intensity ?? 1

  return (
    <>
      {ambient.enabled && (
        <ambientLight color={ambient.color ?? '#ffffff'} intensity={(ambient.intensity ?? 0.4) * lightIntensity} />
      )}
      {lights.map((light, index) => {
        if (light.type === 'directional') {
          return (
            <directionalLight
              key={index}
              position={light.position}
              intensity={(light.intensity ?? 1) * lightIntensity}
              color={light.color}
              castShadow={light.castShadow ?? false}
              shadow-mapSize-width={light.mapSize ?? 2048}
              shadow-mapSize-height={light.mapSize ?? 2048}
              shadow-camera-left={-6}
              shadow-camera-right={6}
              shadow-camera-top={6}
              shadow-camera-bottom={-6}
              shadow-camera-near={0.2}
              shadow-camera-far={18}
              shadow-bias={light.bias ?? -0.00008}
              shadow-normalBias={light.normalBias ?? 0.018}
            />
          )
        }

        if (light.type === 'point') {
          return (
            <pointLight
              key={index}
              position={light.position}
              intensity={(light.intensity ?? 1) * lightIntensity}
              color={light.color}
            />
          )
        }

        return null
      })}
    </>
  )
}
