'use client'

import { setConsoleFunction } from 'three'

const FILTER_KEY = '__autozThreeWarnFilterInstalled'

export function installThreeConsoleFilter() {
  if (typeof window === 'undefined' || window[FILTER_KEY]) return
  window[FILTER_KEY] = true

  setConsoleFunction(null)

  const nativeWarn = console.warn.bind(console)
  console.warn = (...args) => {
    const message = args[0]
    if (
      typeof message === 'string'
      && message.includes('THREE.Clock: This module has been deprecated')
    ) {
      return
    }

    nativeWarn(...args)
  }
}
