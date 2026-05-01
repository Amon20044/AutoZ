'use client'

import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

function createFullscreenTriangle() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2))
  return geometry
}

export function RendererSettings({ exposure = 1.1 }) {
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    gl.toneMappingExposure = exposure
  }, [gl, exposure])

  return null
}

export default function PostProcessing({ config = {} }) {
  const [{ dpr }, size, gl] = useThree((state) => [state.viewport, state.size, state.gl])

  const [screenCamera, screenScene, screen, renderTarget] = useMemo(() => {
    const nextScreenScene = new THREE.Scene()
    const nextScreenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const nextScreen = new THREE.Mesh(createFullscreenTriangle())
    nextScreen.frustumCulled = false
    nextScreenScene.add(nextScreen)

    const nextRenderTarget = new THREE.WebGLRenderTarget(512, 512, {
      samples: 4,
      colorSpace: THREE.SRGBColorSpace,
    })

    nextScreen.material = new THREE.RawShaderMaterial({
      uniforms: {
        diffuse: { value: nextRenderTarget.texture },
        time: { value: 0 },
        glare: { value: 0 },
        grain: { value: 0 },
        vignette: { value: 0 },
        contrast: { value: 1 },
        saturation: { value: 1 },
      },
      vertexShader: /* glsl */ `
        in vec2 uv;
        in vec2 position;
        out vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        out highp vec4 pc_fragColor;
        uniform sampler2D diffuse;
        uniform float time;
        uniform float glare;
        uniform float grain;
        uniform float vignette;
        uniform float contrast;
        uniform float saturation;
        in vec2 vUv;

        float rand(vec2 co) {
          return fract(sin(dot(co.xy, vec2(12.9898, 78.233)) + time * 18.13) * 43758.5453);
        }

        vec3 applySaturation(vec3 color, float amount) {
          float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
          return mix(vec3(luma), color, amount);
        }

        void main() {
          vec4 base = texture(diffuse, vUv);
          vec3 color = base.rgb;

          float radius = 0.006 + glare * 0.012;
          vec3 bloom = vec3(0.0);
          bloom += texture(diffuse, vUv + vec2(radius, 0.0)).rgb;
          bloom += texture(diffuse, vUv + vec2(-radius, 0.0)).rgb;
          bloom += texture(diffuse, vUv + vec2(0.0, radius)).rgb;
          bloom += texture(diffuse, vUv + vec2(0.0, -radius)).rgb;
          bloom += texture(diffuse, vUv + vec2(radius, radius)).rgb;
          bloom += texture(diffuse, vUv + vec2(-radius, radius)).rgb;
          bloom += texture(diffuse, vUv + vec2(radius, -radius)).rgb;
          bloom += texture(diffuse, vUv + vec2(-radius, -radius)).rgb;
          bloom *= 0.125;

          float bright = smoothstep(0.45, 1.0, dot(bloom, vec3(0.2126, 0.7152, 0.0722)));
          color += bloom * bright * glare * 0.8;

          color = ((color - 0.5) * contrast) + 0.5;
          color = applySaturation(color, saturation);

          float grainValue = rand(vUv * 1024.0) - 0.5;
          color += grainValue * grain * 0.16;

          float dist = distance(vUv, vec2(0.5));
          float vignetteMask = smoothstep(0.82, 0.25, dist);
          color *= mix(1.0, vignetteMask, vignette);

          pc_fragColor = vec4(max(color, vec3(0.0)), base.a);
        }
      `,
      glslVersion: THREE.GLSL3,
    })

    return [nextScreenCamera, nextScreenScene, nextScreen, nextRenderTarget]
  }, [])

  useEffect(() => {
    const width = size.width * dpr
    const height = size.height * dpr
    renderTarget.setSize(width, height)
  }, [dpr, renderTarget, size])

  useEffect(() => {
    return () => renderTarget.dispose()
  }, [renderTarget])

  useFrame(({ scene, camera }, delta) => {
    const uniforms = screen.material.uniforms
    uniforms.time.value += delta
    uniforms.glare.value = config.glare ?? 0
    uniforms.grain.value = config.grain ?? 0
    uniforms.vignette.value = config.vignette ?? 0
    uniforms.contrast.value = config.contrast ?? 1
    uniforms.saturation.value = config.saturation ?? 1

    gl.setRenderTarget(renderTarget)
    gl.render(scene, camera)

    gl.setRenderTarget(null)
    gl.render(screenScene, screenCamera)
  }, 1)

  return null
}
