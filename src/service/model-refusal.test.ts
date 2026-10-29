import { describe, expect, it, vi } from 'vitest'
import type { SessionMonitorOptions } from '../sessions/monitor.js'
import type { SessionView } from '../state.js'
import { wireMonitor } from './accounts.js'

const captured = vi.hoisted(() => ({ options: null as SessionMonitorOptions | null }))
vi.mock('../sessions/monitor.js', () => ({ SessionMonitor: class {
  constructor(options: SessionMonitorOptions) { captured.options = options }
} }))
vi.mock('../sessions/mailRelay.js', () => ({ settleMail: vi.fn() }))

describe('a model refusal observed by the service', () => {
  it('invalidates the actual account once per refusal, preserving a new catalogue on later monitor updates', () => {
    const invalidate = vi.fn()
    const ctx = {
      sessions: [], agents: [{ sessionId: 'refused-session', account: 'actual-account' }],
      models: { invalidate }, logStartupDialogs: vi.fn(), hub: { broadcast: vi.fn() }, getState: vi.fn(),
      dispatcher: { check: vi.fn() },
    } as unknown as Parameters<typeof wireMonitor>[0]
    wireMonitor(ctx)
    const refused = { sessionId: 'refused-session', apiErrorKind: 'model', apiError: 'Model unavailable' } as SessionView
    captured.options!.onChange([refused])
    expect(invalidate).toHaveBeenCalledExactlyOnceWith('actual-account')
    captured.options!.onChange([{ ...refused, contextTokens: 42 }])
    expect(invalidate).toHaveBeenCalledTimes(1)
    captured.options!.onChange([{ ...refused, apiErrorKind: null, apiError: null }])
    captured.options!.onChange([refused])
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})
