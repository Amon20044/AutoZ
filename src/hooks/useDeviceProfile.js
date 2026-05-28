'use client'

import { useEffect, useMemo, useState } from 'react'

function detectGpuTier({ deviceMemory, cores, maxTextureSize, isMobile }) {
  if (isMobile && (deviceMemory <= 4 || cores <= 4 || maxTextureSize <= 4096)) return 'low'
  if (deviceMemory >= 8 && cores >= 8 && maxTextureSize >= 8192) return 'high'
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
    }
  }

  const width = window.innerWidth
  const ua = navigator.userAgent || ''
  const isMobileUa = /Android|iPhone|iPod|Mobile/i.test(ua)
  const isTabletUa = /iPad|Tablet/i.test(ua)
  const deviceClass = isMobileUa || width < 720
    ? 'mobile'
    : isTabletUa || width < 1100
      ? 'tablet'
      : 'desktop'

  const deviceMemory = navigator.deviceMemory || (deviceClass === 'desktop' ? 8 : 4)
  const cores = navigator.hardwareConcurrency || 4
  const maxTextureSize = gl?.capabilities?.maxTextureSize || 4096
  const gpuTier = detectGpuTier({
    deviceMemory,
    cores,
    maxTextureSize,
    isMobile: deviceClass === 'mobile',
  })
  const regressed = performanceRegression > 0.5

  if (deviceClass === 'mobile') {
    // Combine the hardware heuristic with the OS-version signal, taking the
    // more conservative of the two. A modern OS never promises more than the
    // RAM/core/texture check allows, but an old OS (e.g. iOS 13 / Android 9)
    // can pull a phone down to the reduced tier even if it looks capable.
    const osInfo = detectMobileOS(ua)
    const mobileTier = regressed ? 'low' : minTier(gpuTier, osQualityTier(osInfo))
    const high = mobileTier === 'high'
    const reduced = mobileTier === 'low'
    return {
      deviceClass,
      gpuTier,
      osName: osInfo.os,
      osVersion: osInfo.version,
      mobileTier,
      // Flagship/modern phones earn a sharper 2x ceiling; the runtime FPS guard
      // still drops this back to 1 if it can't hold frame rate.
      maxDpr: high ? 2 : reduced ? 1 : 1.5,
      maxTextureSize: reduced ? 512 : Math.min(maxTextureSize, 1024),
      preferredLod: reduced ? 'mobile-low' : 'mobile-medium',
      allowHighLod: !reduced,
      allowShadows: false,
      // Always on — the gpuTier picks the cheap "lite" post pass (no bloom /
      // aberration, downscaled target) so phones keep the graded look at low cost.
      allowPostprocessing: true,
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
