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

const TIER_RANK = { low: 0, medium: 1, high: 2 }
const minTier = (a, b) => (TIER_RANK[a] <= TIER_RANK[b] ? a : b)

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
  const maxTextureSize = gl?.capabilities?.maxTextureSize || 4096
  const dpr = window.devicePixelRatio || 1
  const screenPixels = Math.max(width, 1) * Math.max(height, 1) * dpr * dpr
  const osInfo = detectMobileOS(ua)
  const gpuTier = detectGpuTier({
    deviceMemory,
    memoryKnown,
    cores,
    maxTextureSize,
    isMobile: deviceClass === 'mobile',
    osInfo,
    dpr,
    screenPixels,
  })
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
