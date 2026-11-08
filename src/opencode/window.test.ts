import { describe, expect, it, vi } from 'vitest'
import { entryOf } from '../codex/turns.js'
import { SessionMonitor } from '../sessions/monitor.js'
import { OPENCODE } from './name.js'
import { foldSession } from './transcript.js'
import { limitOf, sessionWindow, windowConfig } from './window.js'

const catalogue = JSON.stringify({
  opencode: { models: { 'big-pickle': { limit: { context: 200_000, input: 160_000, output: 32_000 } } } },
  openrouter: { models: { 'minimax/minimax-m3.1-flash': { limit: { context: 1_000_000, output: 64_000 } } } },
  odd: { models: { 'no-output': { limit: { context: 128_000 } } } },
})

describe('limitOf', () => {
  it("reads a model's context and output from the catalogue", () => {
    expect(limitOf(catalogue, 'opencode/big-pickle')).toEqual({ context: 200_000, output: 32_000 })
    expect(limitOf(catalogue, 'openrouter/minimax/minimax-m3.1-flash')).toEqual({ context: 1_000_000, output: 64_000 })
  })

  it('gives nothing for a model the catalogue does not know or a limit without output', () => {
    expect(limitOf(catalogue, 'opencode/unknown')).toBeNull()
    expect(limitOf(catalogue, 'odd/no-output')).toBeNull()
    expect(limitOf('', 'opencode/big-pickle')).toBeNull()
    expect(limitOf(catalogue, 'big-pickle')).toBeNull()
  })
})

describe('sessionWindow', () => {
  it("takes the setting when it is below the model's window", () => {
    expect(sessionWindow(catalogue, 'openrouter/minimax/minimax-m3.1-flash', 250_000)).toEqual({ model: 'openrouter/minimax/minimax-m3.1-flash', window: 250_000, output: 64_000 })
  })

  it("leaves the model's own window when the setting is not below it", () => {
    expect(sessionWindow(catalogue, 'opencode/big-pickle', 250_000)).toBeUndefined()
    expect(sessionWindow(catalogue, 'opencode/big-pickle', 200_000)).toBeUndefined()
  })

  it('sets nothing without a setting, a model or a known limit', () => {
    expect(sessionWindow(catalogue, 'opencode/big-pickle', undefined)).toBeUndefined()
    expect(sessionWindow(catalogue, null, 150_000)).toBeUndefined()
    expect(sessionWindow(catalogue, 'opencode/unknown', 150_000)).toBeUndefined()
  })
})

describe('windowConfig', () => {
  it('limits the model and reserves 32k, so OpenCode compacts where Claude would with the same window', () => {
    expect(windowConfig({ model: 'openrouter/minimax/minimax-m3.1-flash', window: 250_000, output: 64_000 })).toEqual({
      provider: { openrouter: { models: { 'minimax/minimax-m3.1-flash': { limit: { context: 250_000, input: 250_000, output: 64_000 } } } } },
      compaction: { reserved: 32_000 },
    })
  })
})

describe('the window of a session Even Keel set one for', () => {
  const session = { sessionId: 'ses_demo', name: 'ABC-1', cwd: 'D:/work/abc', account: 'demo', startedAt: 1, pid: 0, out: 'D:/work/out.jsonl' }

  it('is in its entry, with the compaction point', () => {
    expect(entryOf({ ...session, contextWindow: 250_000 }, false, OPENCODE)).toMatchObject({ contextWindow: 250_000, compactAt: 218_000 })
    expect(entryOf(session, false, OPENCODE).contextWindow).toBeUndefined()
  })

  it("is the one the page shows, not the model's own from the catalogue", async () => {
    const summary = foldSession([{ id: 'm1', at: 1, data: JSON.stringify({ role: 'assistant', providerID: 'openrouter', modelID: 'minimax/minimax-m3.1-flash' }) }], [])
    const entry = entryOf({ ...session, contextWindow: 250_000 }, false, OPENCODE)
    const monitor = new SessionMonitor({
      homes: () => [{ key: 'demo', dir: 'D:/fake/account', global: false, agent: OPENCODE }], emailOf: () => null, apiKey: () => false, projectKeys: () => ['ABC'], intervalMs: 60_000,
      agentOf: () => ({ sessions: async () => [entry], tail: () => ({ path: undefined, follow: () => {}, read: async () => {}, summary: () => summary }) }),
      contextWindow: () => 1_000_000,
      onAgents: () => {}, onChange: () => {}, onError: () => {},
    })
    monitor.start()
    try {
      await vi.waitFor(() => expect(monitor.views()).toHaveLength(1))
      expect(monitor.views()[0]?.contextWindow).toBe(250_000)
      expect(monitor.compactAtOf('ses_demo')).toBe(218_000)
    } finally {
      await monitor.stop()
    }
  })
})
