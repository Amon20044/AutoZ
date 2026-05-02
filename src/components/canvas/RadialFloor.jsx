'use client'

import { useMemo } from 'react'
import * as THREE from 'three'

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uInner;
  uniform float uOuter;
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - vec2(0.5);
    float r = clamp(length(c) * 2.292, 0.0, 2.5);
    float fade = clamp(1.0 - smoothstep(uInner, uOuter, r), 0.0, 1.0);
    gl_FragColor = vec4(uColor, fade * uStrength);
  }
`

/**
 * Tinted disc fading to transparency — complements ContactShadows.
 */
export default function RadialFloor({
  color = '#94a3b8',
  size = 80,
  opacity = 0.5,
  inner = 0.18,
  outer = 1.15,
  y = -0.012,
  segments = 1,
}) {
  const uniforms = useMemo(() => ({
    uColor: { value: new THREE.Color(color) },
    uStrength: { value: opacity },
    uInner: { value: inner },
    uOuter: { value: outer },
  }), [color, opacity, inner, outer])

  return (
    <mesh
      position={[0, y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={-50}
      frustumCulled={false}
    >
      <planeGeometry args={[size, size, segments, segments]} />
      <shaderMaterial
        attach='material'
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
      />
    </mesh>
  )
}
