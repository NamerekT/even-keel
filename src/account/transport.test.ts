import { describe, expect, it } from 'vitest'
import { isTransport, transportOf } from './transport.js'

describe('transportOf', () => {
  it('runs an API key through the SDK and a subscription on --bg unless the user chose', () => {
    expect(transportOf('claude', undefined, true)).toBe('sdk')
    expect(transportOf('claude', undefined, false)).toBe('bg')
    expect(transportOf('claude', 'sdk', false)).toBe('sdk')
    expect(transportOf('claude', 'bg', true)).toBe('bg')
  })

  it('has none for an agent with one way to run', () => {
    expect(transportOf('codex', undefined, true)).toBeNull()
    expect(transportOf('opencode', 'sdk', false)).toBeNull()
  })
})

describe('isTransport', () => {
  it('takes only the known ways', () => {
    expect(isTransport('sdk')).toBe(true)
    expect(isTransport('bg')).toBe(true)
    expect(isTransport('SDK')).toBe(false)
    expect(isTransport(null)).toBe(false)
  })
})
