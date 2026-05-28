'use client'

import { useEffect, useMemo, useState } from 'react'

function detectGpuTier({
  deviceMemory,
  memoryKnown,
  cores,
  maxTextureSize,
  isMobile,
  osInfo,
  dpr,
  screenPixels,
}) {
  if (!isMobile) {
    if (deviceMemory >= 8 && cores >= 8 && maxTextureSize >= 8192) return 'high'
    if (deviceMemory <= 4 || cores <= 4 || maxTextureSize <= 2048) return 'low'
    return 'medium'
  }

  const oldMobileOS = (osInfo.os === 'ios' && osInfo.version > 0 && osInfo.version <= 13)
    || (osInfo.os === 'android' && osInfo.version > 0 && osInfo.version <= 9)
  if (oldMobileOS || (memoryKnown && deviceMemory <= 3) || cores <= 4 || maxTextureSize <= 2048) {
    return 'low'
  }

  const memoryOk = !memoryKnown || deviceMemory >= 6
  const textureOk = maxTextureSize >= 4096
  const iosHigh = osInfo.os === 'ios' && osInfo.version >= 17 && cores >= 6 && dpr >= 2.5 && memoryOk
  const androidHigh = osInfo.os === 'android' && osInfo.version >= 13 && cores >= 8 && memoryOk && textureOk
  const largeModernScreen = screenPixels >= 1800000 && dpr >= 2.5
  if ((iosHigh || androidHigh || largeModernScreen) && textureOk) return 'high'

  return 'medium'
}

const TIER_RANK = { low: 0, medium: 1, high: 2, ultra: 3 }
const minTier = (a, b) => (TIER_RANK[a] <= TIER_RANK[b] ? a : b)
const maxTier = (a, b) => (TIER_RANK[a] >= TIER_RANK[b] ? a : b)

// One-time synchronous GPU probe. The mount-locked profile in FrameCanvas calls
// getDeviceProfile(null) *before* the R3F canvas exists, so without this we never
// see the real MAX_TEXTURE_SIZE — it defaulted to 4096, which sits below the
// desktop "high" threshold, which is why an RTX 4070 was stuck on the medium
// shader. A throwaway context reads the true caps + unmasked GPU name once,
// caches the result, then releases the context.
let gpuProbe
function probeGpu() {
  if (gpuProbe !== undefined) return gpuProbe
  if (typeof document === 'undefined') {
    gpuProbe = { maxTextureSize: 0, renderer: '' }
    return gpuProbe
  }
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!gl) {
      gpuProbe = { maxTextureSize: 0, renderer: '' }
      return gpuProbe
    }
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '').toLowerCase()
      : ''
    gl.getExtension('WEBGL_lose_context')?.loseContext?.()
    gpuProbe = { maxTextureSize, renderer }
  } catch {
    gpuProbe = { maxTextureSize: 0, renderer: '' }
  }
  return gpuProbe
}

/**
 * Coarse GPU-family signal from the unmasked renderer string. We trust this
 * *more* than the RAM/core heuristic, which can't tell an RTX 4070 from an
 * integrated chip when both report 8GB / 8 cores. null = no strong signal, so
 * the caller falls back to the heuristic.
 */
function classifyRendererTier(renderer) {
  if (!renderer) return null
  const r = renderer

  // Software rasterizers / fallbacks — never premium, force the floor.
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic|virgl/.test(r)) return 'low'

  // Apple Silicon. "apple m1/m2/m3" is a powerhouse; Safari often masks the chip
  // behind a generic "apple gpu", which is still a strong modern GPU.
  if (/apple m\d/.test(r)) return 'ultra'
  if (/apple gpu/.test(r)) return 'high'

  // NVIDIA: any RTX is flagship-class; other GeForce/Quadro are at least high.
  if (/\brtx\s*\d/.test(r)) return 'ultra'
  if (/geforce|quadro|\bgtx\b|nvidia/.test(r)) return 'high'

  // AMD: discrete Radeon RX/Pro are strong; integrated Vega/"Radeon Graphics" mid.
  if (/radeon\s*(?:rx|pro)\b|\brx\s*\d{3,4}\b/.test(r)) return 'high'
  if (/vega|radeon\s*graphics/.test(r)) return 'medium'

  // Intel: Arc is discrete (capable); UHD/Iris/HD Graphics are integrated (mid).
  if (/intel\s*arc|\barc\s*a\d/.test(r)) return 'high'
  if (/intel|\buhd\b|iris|hd graphics/.test(r)) return 'medium'

  return null
}

// Fuse the heuristic tier with the GPU-name signal. The signal wins when it's
// confident: software → low, a named flagship → ultra/high, a named integrated
// GPU caps the heuristic at medium so a roomy-but-weak laptop can't over-promise.
function combineTier(heuristic, signal) {
  if (!signal) return heuristic
  if (signal === 'low') return 'low'
  if (signal === 'ultra') return 'ultra'
  if (signal === 'high') return maxTier(heuristic, 'high')
  return minTier(heuristic, 'medium')
}

/**
 * Parse the mobile OS family + major version from the user-agent string.
 * It's a coarse capability signal — old OS versions ship on weaker GPUs that
 * the RAM/core heuristic alone can miss — so we use it to step quality down.
 */
function detectMobileOS(ua = '') {
  const ios = ua.match(/(?:iPhone|iPad|iPod)[^;)]*?\bOS (\d+)[._]/i)
    || (/iP(hone|od|ad)/i.test(ua) ? ua.match(/Version\/(\d+)/i) : null)
  if (ios) return { os: 'ios', version: parseInt(ios[1], 10) || 0 }
  const android = ua.match(/Android (\d+)/i)
  if (android) return { os: 'android', version: parseInt(android[1], 10) || 0 }
  return { os: 'unknown', version: 0 }
}

/** Map an OS version to a quality tier. Unknown stays neutral (medium). */
function osQualityTier({ os, version }) {
  if (os === 'ios') return version >= 16 ? 'high' : version >= 14 ? 'medium' : 'low'
  if (os === 'android') return version >= 12 ? 'high' : version >= 10 ? 'medium' : 'low'
  return 'medium'
}

function mobilePostprocessingTier({ mobileTier, osInfo, regressed }) {
  if ((osInfo.os === 'android' && osInfo.version > 0 && osInfo.version <= 8)
    || (osInfo.os === 'ios' && osInfo.version > 0 && osInfo.version <= 12)) {
    return 'off'
  }
  if (regressed || mobileTier === 'low') return 'low'
  if (mobileTier === 'high') return 'high'
  return 'medium'
}

export function getDeviceProfile(gl = null, performanceRegression = 0) {
  if (typeof window === 'undefined') {
    return {
      deviceClass: 'desktop',
      gpuTier: 'medium',
      maxDpr: 1.5,
      maxTextureSize: 1024,
      preferredLod: 'desktop-low',
      allowHighLod: true,
      allowShadows: true,
      allowPostprocessing: true,
      postprocessingTier: 'medium',
    }
  }

  const width = window.innerWidth
  const height = window.innerHeight
  const ua = navigator.userAgent || ''
  const isMobileUa = /Android|iPhone|iPod|Mobile/i.test(ua)
  const isTabletUa = /iPad|Tablet/i.test(ua)
  const deviceClass = isMobileUa || width < 720
    ? 'mobile'
    : isTabletUa || width < 1100
      ? 'tablet'
      : 'desktop'

  const memoryKnown = typeof navigator.deviceMemory === 'number'
  const deviceMemory = memoryKnown ? navigator.deviceMemory : (deviceClass === 'desktop' ? 8 : 6)
  const cores = navigator.hardwareConcurrency || 4
  const probe = probeGpu()
  const maxTextureSize = gl?.capabilities?.maxTextureSize || probe.maxTextureSize || 4096
  const dpr = window.devicePixelRatio || 1
  const screenPixels = Math.max(width, 1) * Math.max(height, 1) * dpr * dpr
  const osInfo = detectMobileOS(ua)
  const heuristicTier = detectGpuTier({
    deviceMemory,
    memoryKnown,
    cores,
    maxTextureSize,
    isMobile: deviceClass === 'mobile',
    osInfo,
    dpr,
    screenPixels,
  })
  // Mobile keeps the carefully-tuned heuristic+OS path untouched; desktop/tablet
  // fuse in the GPU-name signal so flagship silicon can reach 'ultra' and weak
  // integrated chips get pinned to 'medium' regardless of RAM/core counts.
  const gpuTier = deviceClass === 'mobile'
    ? heuristicTier
    : combineTier(heuristicTier, classifyRendererTier(probe.renderer))
  const regressed = performanceRegression > 0.5

  if (deviceClass === 'mobile') {
    // Combine the hardware heuristic with the OS-version signal, taking the
    // more conservative of the two. A modern OS never promises more than the
    // RAM/core/texture check allows, but an old OS (e.g. iOS 13 / Android 9)
    // can pull a phone down to the reduced tier even if it looks capable.
    const mobileTier = regressed ? 'low' : minTier(gpuTier, osQualityTier(osInfo))
    const high = mobileTier === 'high'
    const reduced = mobileTier === 'low'
    const postprocessingTier = mobilePostprocessingTier({ mobileTier, osInfo, regressed })
    return {
      deviceClass,
      gpuTier,
      osName: osInfo.os,
      osVersion: osInfo.version,
      mobileTier,
      // Flagship/modern phones earn a sharper 2x ceiling; the runtime FPS guard
      // still drops this back to 1 if it can't hold frame rate.
      maxDpr: high ? 2 : reduced ? 1 : 1.5,
      maxTextureSize: high ? Math.min(maxTextureSize, 2048) : reduced ? 512 : Math.min(maxTextureSize, 1024),
      preferredLod: reduced ? 'mobile-low' : 'mobile-medium',
      allowHighLod: !reduced,
      allowShadows: false,
      allowPostprocessing: postprocessingTier !== 'off',
      postprocessingTier,
      // Runtime FPS headroom can ratchet post-processing up to this ceiling (see
      // FrameCanvas). Mobile detection is coarse/conservative, so a phone that
      // sustains a high frame rate earns the heavy shader it was denied at mount.
      maxPostprocessingTier: postprocessingTier === 'off' ? 'off' : reduced ? 'low' : 'high',
    }
  }

  if (deviceClass === 'tablet') {
    return {
      deviceClass,
      gpuTier,
      maxDpr: 1.5,
      maxTextureSize: gpuTier === 'high' && !regressed ? Math.min(maxTextureSize, 2048) : 1024,
      preferredLod: 'tablet-low',
      allowHighLod: gpuTier !== 'low' && !regressed,
      allowShadows: gpuTier !== 'low',
      allowPostprocessing: true,
      postprocessingTier: regressed || gpuTier === 'low' ? 'low' : 'medium',
      maxPostprocessingTier: gpuTier === 'low' ? 'low' : 'high',
    }
  }

  return {
    deviceClass,
    gpuTier,
    maxDpr: regressed ? 1.25 : 2,
    maxTextureSize: regressed ? 1024 : Math.min(maxTextureSize, 2048),
    preferredLod: 'desktop-low',
    allowHighLod: !regressed,
    allowShadows: !regressed,
    allowPostprocessing: true,
    postprocessingTier: regressed ? 'low' : gpuTier,
  }
}

export function useDeviceProfile(gl = null, performanceRegression = 0) {
  const [sizeKey, setSizeKey] = useState('')

  useEffect(() => {
    const update = () => setSizeKey(`${window.innerWidth}x${window.innerHeight}`)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return useMemo(
    () => getDeviceProfile(gl, performanceRegression),
    [gl, performanceRegression, sizeKey],
  )
}
