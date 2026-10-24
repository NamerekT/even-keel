import { describe, expect, it } from 'vitest'
import { executionOfChoices, isTransport, transportOf } from './transport.js'

describe('transportOf', () => {
  it('runs an API key through the SDK and a subscription on --bg on auto or without the setting', () => {
    expect(transportOf('claude', 'auto', true)).toBe('sdk')
    expect(transportOf('claude', 'auto', false)).toBe('bg')
    expect(transportOf('claude', undefined, true)).toBe('sdk')
    expect(transportOf('claude', undefined, false)).toBe('bg')
  })

  it('runs every account one way when the setting names it', () => {
    expect(transportOf('claude', 'sdk', false)).toBe('sdk')
    expect(transportOf('claude', 'bg', true)).toBe('bg')
  })

  it('has none for an agent with one way to run', () => {
    expect(transportOf('codex', 'bypass', true)).toBeNull()
    expect(transportOf('opencode', 'sdk', false)).toBeNull()
    expect(transportOf('copilot', undefined, true)).toBeNull()
  })
})

describe('executionOfChoices', () => {
  const key = { key: 'team-api', transport: 'sdk', apiKey: true } as const
  const subscription = { key: 'global', transport: 'bg', apiKey: false } as const

  it('is auto when each choice is what auto gives the account, and with no Claude account', () => {
    expect(executionOfChoices([key, subscription])).toEqual({ execution: 'auto', moved: [] })
    expect(executionOfChoices([])).toEqual({ execution: 'auto', moved: [] })
  })

  it('is the SDK when every account chose it', () => {
    expect(executionOfChoices([key, { ...subscription, transport: 'sdk' }])).toEqual({ execution: 'sdk', moved: [] })
  })

  it('is auto otherwise and names the accounts whose way it changes', () => {
    const keyOnBg = { ...key, transport: 'bg' } as const
    expect(executionOfChoices([keyOnBg, subscription])).toEqual({ execution: 'auto', moved: [keyOnBg] })
    const subscriptionOnSdk = { ...subscription, transport: 'sdk' } as const
    expect(executionOfChoices([keyOnBg, subscriptionOnSdk])).toEqual({ execution: 'auto', moved: [keyOnBg, subscriptionOnSdk] })
  })
})

describe('isTransport', () => {
  it('takes only the known ways', () => {
    expect(isTransport('sdk')).toBe(true)
    expect(isTransport('bg')).toBe(true)
    expect(isTransport('auto')).toBe(false)
    expect(isTransport('SDK')).toBe(false)
    expect(isTransport(null)).toBe(false)
  })
})
