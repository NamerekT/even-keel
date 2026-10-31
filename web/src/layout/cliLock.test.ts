import { describe, expect, it } from 'vitest'
import { cliLockOf } from './cliLock.js'

describe('cliLockOf', () => {
  it('locks the installed CLI while the execution picked runs only on the checked copy', () => {
    expect(cliLockOf('claude', 'sdk', 'bg')).toBe('picked')
    expect(cliLockOf('claude', 'sdk', 'sdk')).toBe('picked')
  })

  it('keeps it locked while the Agent SDK is still saved, though the form already moved off it (BTN-638)', () => {
    expect(cliLockOf('claude', 'bg', 'sdk')).toBe('saved')
    expect(cliLockOf('claude', 'auto', 'sdk')).toBe('saved')
  })

  it('opens it once neither the form nor the config runs on the copy alone', () => {
    expect(cliLockOf('claude', 'bg', 'bg')).toBeNull()
    expect(cliLockOf('claude', undefined, undefined)).toBeNull()
    expect(cliLockOf('codex', 'sandbox', 'bypass')).toBeNull()
  })
})
