'use client'

import { useEffect, useRef, useState } from 'react'
import { KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react'

export const TEST_KEY_STORAGE = 'autoz:test-key:v1'

export function readStoredTestKey() {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(TEST_KEY_STORAGE) || ''
  } catch {
    return ''
  }
}

export function writeStoredTestKey(key) {
  if (typeof window === 'undefined') return
  try {
    if (key) window.localStorage.setItem(TEST_KEY_STORAGE, key)
    else window.localStorage.removeItem(TEST_KEY_STORAGE)
  } catch {
    // Quota — silent.
  }
}

/**
 * Modal that asks for the Pre-Register Key before a publish attempt.
 * Resolves with { key } on submit, or null on cancel.
 */
export default function TestKeyModal({
  open,
  initialKey = '',
  error = null,
  submitting = false,
  onCancel,
  onSubmit,
}) {
  const [value, setValue] = useState(initialKey)
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) {
      setValue(initialKey)
      const id = window.requestAnimationFrame(() => inputRef.current?.focus())
      return () => window.cancelAnimationFrame(id)
    }
    return undefined
  }, [initialKey, open])

  if (!open) return null

  const handleSubmit = (event) => {
    event.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit?.(trimmed)
  }

  return (
    <div className='az-publish-overlay' role='dialog' aria-modal='true' aria-labelledby='test-key-title' onClick={onCancel}>
      <form className='az-publish-dialog test-key-dialog' onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
        <div className='test-key-icon'>
          <ShieldCheck size={20} strokeWidth={2} aria-hidden='true' />
        </div>
        <h2 id='test-key-title'>Enter your Pre-Register Key</h2>
        <p>
          Publishing on the AutoZ platform is gated by a Pre-Register Key. Paste the key you were issued —
          we&apos;ll cache it on this device for the rest of the session.
        </p>
        <label className='test-key-input-row'>
          <KeyRound size={14} aria-hidden='true' />
          <input
            ref={inputRef}
            type='password'
            spellCheck={false}
            autoComplete='off'
            placeholder='paste Pre-Register Key'
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={submitting}
          />
        </label>
        {error && <div className='test-key-error' role='alert'>{error}</div>}
        <div className='az-publish-actions'>
          <button type='button' className='az-btn' onClick={onCancel} disabled={submitting}>Cancel</button>
          <button type='submit' className='az-btn az-btn--primary' disabled={submitting || !value.trim()}>
            {submitting
              ? (<><LoaderCircle size={14} className='az-icon-spin' aria-hidden='true' /> <span>Verifying…</span></>)
              : (<><ShieldCheck size={14} aria-hidden='true' /> <span>Unlock publish</span></>)}
          </button>
        </div>
      </form>
    </div>
  )
}
