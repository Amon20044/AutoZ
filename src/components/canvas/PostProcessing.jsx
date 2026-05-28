'use client'

import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

function createFullscreenTriangle() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2))
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4)
  return geometry
}

export function RendererSettings({ exposure = 1.1 }) {
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    gl.toneMappingExposure = exposure
  }, [gl, exposure])

  return null
}

// Per-tier post-processing budget. Picked once at mount, never changes during
// the session — that's the whole reason this exists. Re-deriving these mid-run
// (e.g. on an FPS dip during an LOD swap) recreates render targets and is what
// caused the visible glitch on weaker phones.
const TIER_BUDGET = {
  high:   { samples: 4, scale: 1.00, lite: false },
  medium: { samples: 2, scale: 0.85, lite: true },
  low:    { samples: 0, scale: 0.65, lite: true },
}

const TIER_LIMITS = {
  high: {
    glare: Infinity,
    grain: Infinity,
    vignette: Infinity,
    bloomIntensity: Infinity,
    sharpness: Infinity,
    chromaticAberration: Infinity,
  },
  medium: {
    glare: 0.35,
    grain: 0.055,
    vignette: 0.18,
    bloomIntensity: 0.25,
    sharpness: 0.08,
    chromaticAberration: 0.0005,
  },
  low: {
    glare: 0.12,
    grain: 0.035,
    vignette: 0.12,
    bloomIntensity: 0.1,
    sharpness: 0.04,
    chromaticAberration: 0.0002,
  },
}

function resolveBudget(tier, deviceClass) {
  const budget = TIER_BUDGET[tier] ?? TIER_BUDGET.high
  if (deviceClass === 'mobile' && tier === 'medium') {
    return { ...budget, samples: 0, scale: 0.78 }
  }
  return budget
}

function cap(value, fallback, max) {
  const next = value ?? fallback
  return Number.isFinite(max) ? Math.min(next, max) : next
}

function buildFragmentShader({ lite }) {
  // Heavy shader: bloom (8-tap), chromatic aberration, unsharp-mask sharpen,
  // grain, vignette, contrast, saturation. Used for desktop / high-tier tablet.
  if (!lite) return /* glsl */ `
    precision highp float;
    out highp vec4 pc_fragColor;
    uniform sampler2D diffuse;
    uniform vec2 resolution;
    uniform float time;
    uniform float glare;
    uniform float grain;
    uniform float vignette;
    uniform float contrast;
    uniform float saturation;
    uniform float bloomThreshold;
    uniform float bloomIntensity;
    uniform float sharpness;
    uniform float chromaticAberration;
    in vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233)) + time * 18.13) * 43758.5453);
    }

    vec3 applySaturation(vec3 color, float amount) {
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      return mix(vec3(luma), color, amount);
    }

    vec3 sampleScene(vec2 uv) {
      return texture(diffuse, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
    }

    vec3 unsharpMask(vec2 uv, vec3 color) {
      vec2 texel = 1.0 / max(resolution, vec2(1.0));
      vec3 blur = vec3(0.0);
      blur += sampleScene(uv + vec2(texel.x, 0.0));
      blur += sampleScene(uv - vec2(texel.x, 0.0));
      blur += sampleScene(uv + vec2(0.0, texel.y));
      blur += sampleScene(uv - vec2(0.0, texel.y));
      blur *= 0.25;
      return mix(color, color + (color - blur), sharpness);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      vec2 aberration = centered * chromaticAberration;
      vec4 base = texture(diffuse, vUv);
      vec3 color = vec3(
        texture(diffuse, vUv + aberration).r,
        base.g,
        texture(diffuse, vUv - aberration).b
      );

      float radius = 0.0025 + glare * 0.006;
      vec3 bloom = vec3(0.0);
      bloom += sampleScene(vUv + vec2(radius, 0.0));
      bloom += sampleScene(vUv + vec2(-radius, 0.0));
      bloom += sampleScene(vUv + vec2(0.0, radius));
      bloom += sampleScene(vUv + vec2(0.0, -radius));
      bloom += sampleScene(vUv + vec2(radius, radius));
      bloom += sampleScene(vUv + vec2(-radius, radius));
      bloom += sampleScene(vUv + vec2(radius, -radius));
      bloom += sampleScene(vUv + vec2(-radius, -radius));
      bloom *= 0.125;

      float bright = smoothstep(bloomThreshold, 1.0, dot(bloom, vec3(0.2126, 0.7152, 0.0722)));
      color += bloom * bright * glare * bloomIntensity;
      color = unsharpMask(vUv, color);

      color = ((color - 0.5) * contrast) + 0.5;
      color = applySaturation(color, saturation);

      float grainValue = rand(vUv * 1024.0) - 0.5;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color += grainValue * grain * mix(0.08, 0.18, 1.0 - luma);

      float dist = distance(vUv, vec2(0.5));
      float vignetteMask = smoothstep(0.86, 0.24, dist);
      color *= mix(1.0, vignetteMask, vignette);

      pc_fragColor = vec4(clamp(color, vec3(0.0), vec3(1.0)), base.a);
    }
  `

  // Lite shader: only color-grade + vignette + grain. No bloom, no aberration,
  // no sharpen, no extra texture taps. Safe on old GPUs without context loss.
  return /* glsl */ `
    precision mediump float;
    out vec4 pc_fragColor;
    uniform sampler2D diffuse;
    uniform float time;
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

      color = ((color - 0.5) * contrast) + 0.5;
      color = applySaturation(color, saturation);

      if (grain > 0.0) {
        float grainValue = rand(vUv * 512.0) - 0.5;
        color += grainValue * grain * 0.12;
      }

      if (vignette > 0.0) {
        float dist = distance(vUv, vec2(0.5));
        float vignetteMask = smoothstep(0.88, 0.28, dist);
        color *= mix(1.0, vignetteMask, vignette);
      }

      pc_fragColor = vec4(clamp(color, vec3(0.0), vec3(1.0)), base.a);
    }
  `
}

export default function PostProcessing({ config = {}, tier = 'high', deviceClass = 'desktop' }) {
  const [dpr, size, gl] = useThree((state) => [state.viewport.dpr, state.size, state.gl])

  // Pin the render-target budget for this component lifetime. The frame canvas
  // changes the key when auto quality drops to a cheaper tier, so the target and
  // shader are recreated deliberately instead of thrashing during every FPS tick.
  const budget = useMemo(() => resolveBudget(tier, deviceClass), [deviceClass, tier])
  const limits = TIER_LIMITS[tier] ?? TIER_LIMITS.high

  const [screenCamera, screenScene, screen, renderTarget] = useMemo(() => {
    const nextScreenScene = new THREE.Scene()
    const nextScreenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const nextScreen = new THREE.Mesh(createFullscreenTriangle())
    nextScreen.frustumCulled = false
    nextScreenScene.add(nextScreen)

    const nextRenderTarget = new THREE.WebGLRenderTarget(512, 512, {
      samples: budget.samples,
      colorSpace: THREE.SRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      stencilBuffer: false,
      depthBuffer: true,
    })
    nextRenderTarget.texture.generateMipmaps = false

    nextScreen.material = new THREE.RawShaderMaterial({
      uniforms: {
        diffuse: { value: nextRenderTarget.texture },
        resolution: { value: new THREE.Vector2(512, 512) },
        time: { value: 0 },
        glare: { value: 0 },
        grain: { value: 0 },
        vignette: { value: 0 },
        contrast: { value: 1 },
        saturation: { value: 1 },
        bloomThreshold: { value: 0.62 },
        bloomIntensity: { value: 0.28 },
        sharpness: { value: 0.08 },
        chromaticAberration: { value: 0.0008 },
      },
      vertexShader: /* glsl */ `
        in vec2 uv;
        in vec3 position;
        out vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: buildFragmentShader({ lite: budget.lite }),
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
    })

    return [nextScreenCamera, nextScreenScene, nextScreen, nextRenderTarget]
  // budget is locked for the component lifetime by the parent's static gate
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const scale = budget.scale
    const width = Math.max(1, Math.floor(size.width * dpr * scale))
    const height = Math.max(1, Math.floor(size.height * dpr * scale))
    const resolution = screen.material.uniforms.resolution.value
    renderTarget.setSize(width, height)
    resolution.set(width, height)
  }, [budget, dpr, renderTarget, screen, size])

  useEffect(() => {
    return () => renderTarget.dispose()
  }, [renderTarget])

  useFrame(({ scene, camera }, delta) => {
    const uniforms = screen.material.uniforms
    uniforms.time.value += delta
    uniforms.glare.value = cap(config.glare, 0, limits.glare)
    uniforms.grain.value = cap(config.grain, 0, limits.grain)
    uniforms.vignette.value = cap(config.vignette, 0, limits.vignette)
    uniforms.contrast.value = config.contrast ?? 1
    uniforms.saturation.value = config.saturation ?? 1
    uniforms.bloomThreshold.value = config.bloomThreshold ?? 0.62
    uniforms.bloomIntensity.value = cap(config.bloomIntensity, 0.28, limits.bloomIntensity)
    uniforms.sharpness.value = cap(config.sharpness, 0.08, limits.sharpness)
    uniforms.chromaticAberration.value = cap(config.chromaticAberration, 0.0008, limits.chromaticAberration)

    gl.setRenderTarget(renderTarget)
    gl.render(scene, camera)

    gl.setRenderTarget(null)
    gl.render(screenScene, screenCamera)
  }, 1)

  return null
}
