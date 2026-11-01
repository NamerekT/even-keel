import { describe, expect, it } from 'vitest'
import { cliLockOf } from './cliLock.js'

describe('cliLockOf', () => {
  it('locks the installed CLI while the execution picked runs only on the checked copy', () => {
    expect(cliLockOf('claude', 'sdk')).toBe('picked')
  })

  it('opens it once the form is off the Agent SDK, saved or not (BTN-682)', () => {
    expect(cliLockOf('claude', 'bg')).toBeNull()
    expect(cliLockOf('claude', 'auto')).toBeNull()
    expect(cliLockOf('claude', undefined)).toBeNull()
    expect(cliLockOf('codex', 'sandbox')).toBeNull()
  })
})
