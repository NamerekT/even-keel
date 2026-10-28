import { describe, expect, it } from 'vitest'
import { pickedProvider } from './settingsRun.js'

describe('picked provider', () => {
  it('goes back to "as shared" when the shared provider is picked again', () => {
    expect(pickedProvider('codex', '', 'codex')).toBe('')
  })

  it('makes another provider the project own', () => {
    expect(pickedProvider('claude', '', 'codex')).toBe('claude')
  })

  it('keeps the saved own value when it is picked again', () => {
    expect(pickedProvider('codex', 'codex', 'codex')).toBe('codex')
    expect(pickedProvider('claude', 'claude', 'codex')).toBe('claude')
  })

  it('makes the shared provider own when the saved value was another own one', () => {
    expect(pickedProvider('codex', 'claude', 'codex')).toBe('codex')
  })
})
