import { describe, expect, it, vi } from 'vitest'
import { RolloutFold } from '../codex/rollout.js'
import { foldSession } from '../opencode/transcript.js'
import { foldEvents } from '../copilot/transcript.js'
import { lampOf } from './agents.js'
import { SessionMonitor } from './monitor.js'
import { TranscriptFold } from './transcript.js'

const at = '2026-10-27T10:00:00.000Z'
const claudeError = (text: string, error = 'unknown') => JSON.stringify({
  type: 'assistant', timestamp: at, isApiErrorMessage: true, error,
  message: { role: 'assistant', content: [{ type: 'text', text }] },
})
const claude = (text: string, error?: string) => {
  const fold = new TranscriptFold()
  fold.push(claudeError(text, error))
  return fold.summary()
}
const codex = (message: string, codex_error_info = 'other') => {
  const fold = new RolloutFold()
  fold.push(JSON.stringify({ type: 'event_msg', timestamp: at, payload: { type: 'task_complete', error: { message, codex_error_info } } }))
  return fold.summary()
}

describe('temporary model errors', () => {
  it.each(['Selected model is at capacity. Please try a different model.', 'API Error: 529 Overloaded.', 'HTTP 503 Service unavailable'])('recognizes %s in every transcript format', (message) => {
    const open = foldSession([{ id: 'm1', at: Date.parse(at), data: JSON.stringify({ role: 'assistant', error: { name: 'APIError', data: { message } } }) }], [])
    const copilot = foldEvents(JSON.stringify({ type: 'session.error', timestamp: at, data: { errorType: 'error', message } }))
    for (const summary of [claude(message), codex(message), open, copilot]) expect(summary.apiError).toMatchObject({ kind: 'transient', text: message, at })
  })

  it('recognizes provider codes even when the message is generic', () => {
    expect(claude('Try again', 'overloaded_error').apiError?.kind).toBe('transient')
    expect(codex('Try again', 'server_is_overloaded').apiError?.kind).toBe('transient')
    const fold = new RolloutFold()
    fold.push(JSON.stringify({ type: 'event_msg', timestamp: at, payload: { type: 'error', message: 'Try again', codex_error_info: 'server_is_overloaded' } }))
    expect(fold.summary().apiError?.kind).toBe('transient')
    expect(foldEvents(JSON.stringify({ type: 'session.error', timestamp: at, data: { errorType: 'overloaded_error', message: 'Try again' } })).apiError?.kind).toBe('transient')
  })

  it('keeps permanent failures and limits distinct, and clears a recovered refusal', () => {
    for (const message of ['Invalid API key', 'Model not supported', 'socket hang up', 'HTTP 503 Invalid request']) {
      expect(claude(message).apiError?.kind).toBe('error')
      expect(codex(message).apiError?.kind).toBe('error')
    }
    expect(claude('Rate limit', 'rate_limit').apiError?.kind).toBe('limit')
    const fold = new TranscriptFold()
    fold.push(claudeError('Overloaded'))
    fold.push(JSON.stringify({ type: 'assistant', timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text: 'Recovered' }] } }))
    expect(fold.summary().apiError).toBeNull()
  })

  it('shows a resting overloaded session as waiting and a retrying turn as working', () => {
    const agent = { sessionId: 's1', kind: 'codex', cwd: 'D:/fake', startedAt: 0, resting: true, status: 'idle' as const }
    expect(lampOf(agent, 'transient')).toBe('waiting')
    expect(lampOf({ ...agent, status: 'busy' }, 'transient')).toBe('working')
    expect(lampOf({ ...agent, state: 'failed' }, 'transient')).toBe('waiting')
  })

  it.each([true, false])('offers a transient refusal to the chain for an API or subscription account (%s)', async (apiKey) => {
    const summary = claude('Selected model is at capacity.')
    const error = vi.fn()
    const monitor = new SessionMonitor({
      homes: () => [{ key: 'global', configDir: 'D:/fake/account', global: true, agent: 'claude' }],
      emailOf: () => null, apiKey: () => apiKey, projectKeys: () => ['ABC'], intervalMs: 60_000,
      agentOf: () => ({
        sessions: async () => [{ sessionId: 's1', name: 'ABC-1', cwd: 'D:/fake', kind: 'sdk', startedAt: Date.now(), resting: true, status: 'idle' }],
        tail: () => ({ path: undefined, follow: () => {}, read: async () => {}, summary: () => summary }),
      }),
      onAgents: () => {}, onChange: () => {}, onError: error,
    })
    monitor.start()
    try {
      await vi.waitFor(() => expect(monitor.views()).toHaveLength(1))
      expect(error).not.toHaveBeenCalled()
      expect(monitor.views()[0]).toMatchObject({ lamp: 'waiting', apiErrorKind: 'transient' })
      expect(monitor.limited('ABC-1')).toMatchObject({ transient: true, limit: { at } })
    } finally { await monitor.stop() }
  })
})
