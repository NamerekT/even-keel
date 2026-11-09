import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import type { SessionTail } from '../agent/contract.js'
import { createEvenKeelServer } from '../server.js'
import type { AgentEntry } from '../sessions/agents.js'
import { SessionMonitor } from '../sessions/monitor.js'
import { TranscriptFold } from '../sessions/transcript.js'
import type { SessionRecord } from '../state.js'
import { wireServer } from './hosting.js'

vi.mock('../server.js', () => ({ createEvenKeelServer: vi.fn() }))

const monitors: SessionMonitor[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(async () => {
  for (const monitor of monitors.splice(0)) await monitor.stop()
  vi.useRealTimers()
  vi.clearAllMocks()
})

function rig() {
  let entries: AgentEntry[] = []
  let window: number | null = 250_000
  const home: AccountHome = { key: 'global', dir: '/account', global: true, agent: 'claude' }
  const summary = new TranscriptFold().summary()
  summary.contextTokens = 212_000
  const tail: SessionTail = { path: undefined, follow: () => {}, read: async () => {}, summary: () => summary }
  const error = vi.fn()
  const monitor = new SessionMonitor({
    homes: () => [home], agentOf: () => ({ sessions: async () => entries, tail: () => tail }),
    emailOf: () => null, apiKey: () => false, projectKeys: () => ['ABC'], intervalMs: 10,
    contextWindow: () => window, onAgents: () => {}, onChange: () => {}, onError: error,
  })
  monitors.push(monitor)
  const record = vi.fn(async (_home: AccountHome, sessionId: string): Promise<SessionRecord | undefined> => ({
    sessionId, startedAt: null, lastActivityAt: null, contextTokens: 212_000, contextWindow: null,
    tokens: summary.tokens, stage: null, feed: [], workdir: null, branch: null, apiError: null, account: null,
  }))
  wireServer({
    homes: { list: () => [home] }, agentOf: () => ({ record }), monitor,
    sessionAccount: () => null, emailAt: () => 'test@example.com',
  } as unknown as Parameters<typeof wireServer>[0])
  const read = vi.mocked(createEvenKeelServer).mock.calls.at(-1)![0].sessionRecord
  monitor.start()
  return {
    read, record, monitor,
    async poll(sessionId: string | null, value: number | null = 250_000) {
      window = value
      entries = sessionId === null ? [] : [{
        sessionId, cwd: '/repo', kind: 'sdk', name: 'ABC-1', model: 'opus',
        startedAt: Date.now(), resting: true, status: 'idle',
      }]
      await vi.advanceTimersByTimeAsync(10)
      expect(error).not.toHaveBeenCalled()
    },
  }
}

describe('the context window of a session record', () => {
  it('keeps the observed window after the session finishes and another session takes its task', async () => {
    const r = rig()
    await r.poll('first')
    expect(r.monitor.views()[0]?.contextWindow).toBe(250_000)
    await r.poll(null)
    expect(r.monitor.views()[0]?.lamp).toBe('finished')
    await r.poll('second', 400_000)
    expect(await r.read('first')).toMatchObject({ contextWindow: 250_000, contextTokens: 212_000, account: 'test@example.com' })
    expect(await r.read('second')).toMatchObject({ contextWindow: 400_000 })
  })

  it('keeps null for an unseen session, including after a service restart', async () => {
    const r = rig()
    await r.poll('first')
    expect(await r.read('unseen')).toMatchObject({ contextWindow: null })
    const restarted = rig()
    expect(await restarted.read('first')).toMatchObject({ contextWindow: null })
  })

  it('updates the last non-null window and does not erase it on an unknown reading', async () => {
    const r = rig()
    await r.poll('first', null)
    expect(await r.read('first')).toMatchObject({ contextWindow: null })
    await r.poll('first')
    await r.poll('first', 300_000)
    await r.poll('first', null)
    expect(await r.read('first')).toMatchObject({ contextWindow: 300_000 })
  })

  it.each([237_500, 180_000])('preserves the record\'s own window (%i)', async (contextWindow) => {
    const r = rig()
    await r.poll('first')
    const found = (await r.record({} as AccountHome, 'first'))!
    r.record.mockResolvedValue({ ...found, contextWindow })
    expect(await r.read('first')).toMatchObject({ contextWindow })
  })

  it('evicts the oldest session on the 501st, without renewing it on updates or reads', async () => {
    const r = rig()
    await r.poll('session-0')
    await r.poll('session-1')
    await r.poll('session-0', 300_000)
    await r.read('session-0')
    for (let i = 2; i <= 500; i++) await r.poll(`session-${i}`)
    expect(await r.read('session-0')).toMatchObject({ contextWindow: null })
    expect(await r.read('session-1')).toMatchObject({ contextWindow: 250_000 })
    expect(await r.read('session-500')).toMatchObject({ contextWindow: 250_000 })
  })

  it('does not synthesize a missing record or hide a read failure', async () => {
    const r = rig()
    await r.poll('first')
    r.record.mockResolvedValue(undefined)
    expect(await r.read('first')).toBeUndefined()
    r.record.mockRejectedValue(new Error('unreadable transcript'))
    await expect(r.read('first')).rejects.toThrow('unreadable transcript')
  })
})
