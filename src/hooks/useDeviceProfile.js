'use client'

import { useEffect, useMemo, useState } from 'react'

function detectGpuTier({ deviceMemory, cores, maxTextureSize, isMobile }) {
  if (isMobile && (deviceMemory <= 4 || cores <= 4 || maxTextureSize <= 4096)) return 'low'
  if (deviceMemory >= 8 && cores >= 8 && maxTextureSize >= 8192) return 'high'
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
    const highMobile = gpuTier !== 'low' && !regressed
    return {
      deviceClass,
      gpuTier,
      maxDpr: highMobile ? 1.5 : 1,
      maxTextureSize: highMobile ? Math.min(maxTextureSize, 1024) : 512,
      preferredLod: highMobile ? 'mobile-medium' : 'mobile-low',
      allowHighLod: highMobile,
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
