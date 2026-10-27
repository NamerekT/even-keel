import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnRegistry } from '../codex/turns.js'
import { lampOf } from '../sessions/agents.js'
import { OpenCodeCli, turnEnded } from './cli.js'
import { sessionStamp } from './db.js'
import { foldSession } from './transcript.js'

vi.mock('./db.js', () => ({ sessionStamp: vi.fn(), sessionList: vi.fn() }))
vi.mock('../agent/process.js', () => ({ isAlive: () => true, killTree: vi.fn() }))
vi.mock('../codex/process.js', async (original) => ({ ...await original<typeof import('../codex/process.js')>(), polledProcessStartedAt: async () => undefined }))

afterEach(() => vi.restoreAllMocks())

describe('a stream error with a live silent OpenCode turn', () => {
  it.each(['Free usage limit reached', 'connection closed'])('exposes %s and preserves the live process for stop/resume', async (message) => {
    const root = mkdtempSync(join(tmpdir(), 'ek-opencode-stream-'))
    try {
      const now = Date.parse('2026-10-27T08:30:00Z')
      const changed = now - 60_000
      vi.spyOn(Date, 'now').mockReturnValue(now)
      vi.mocked(sessionStamp).mockResolvedValue(changed)
      const registry = new TurnRegistry(join(root, 'turns'))
      const out = registry.turnFile('DEMO-1', changed)
      writeFileSync(out, JSON.stringify({ type: 'step_start', sessionID: 'ses_demo' }) + '\n')
      utimesSync(out, changed / 1000, changed / 1000)
      registry.save({ sessionId: 'ses_demo', name: 'DEMO-1', cwd: root, account: 'demo', startedAt: changed, pid: 123, out })
      const home = { key: 'demo', dir: root, agent: 'opencode', global: false }
      mkdirSync(join(root, 'data', 'opencode', 'log'), { recursive: true })
      writeFileSync(join(root, 'data', 'opencode', 'log', 'opencode.log'), `ERROR 2026-10-27T08:29:10 +1ms session.id=ses_demo message="stream error" error.error=${JSON.stringify(message)}\n`)
      const cli = () => new OpenCodeCli(() => 'unused', 100, () => ({}), registry)
      const current = cli()
      vi.mocked(sessionStamp).mockResolvedValue(undefined)
      expect((await current.sessions(home))[0]?.status).toBe('busy')
      vi.mocked(sessionStamp).mockResolvedValue(now)
      expect((await current.sessions(home))[0]?.status).toBe('busy')
      vi.mocked(sessionStamp).mockResolvedValue(changed)
      const entry = (await current.sessions(home))[0]!
      expect(entry).toMatchObject({ status: 'idle', pid: 123 })
      expect(entry.hungSince).toBeUndefined()
      const errors = await current.turnErrors('ses_demo')
      expect(errors).toHaveLength(1)
      const summary = foldSession([], [], undefined, false, errors)
      expect(summary.apiError?.kind).toBe(message.startsWith('Free') ? 'limit' : 'error')
      expect(lampOf(entry, summary.apiError!.kind)).toBe(message.startsWith('Free') ? 'limit' : 'error')
      expect(turnEnded(readFileSync(out, 'utf8'))).toBe(false)
      expect((await current.sessions(home))[0]?.status).toBe('idle')
      expect(await cli().turnErrors('ses_demo')).toEqual(errors)
      expect((await cli().sessions(home))[0]?.status).toBe('idle')
      if (message === 'connection closed') expect(summary.apiError?.notice?.code).toBe('opencode.streamError')

      const next = registry.turnFile('DEMO-1', now)
      writeFileSync(next, JSON.stringify({ type: 'step_start', sessionID: 'ses_demo' }) + '\n')
      registry.save({ ...(await registry.get('ses_demo'))!, out: next })
      vi.mocked(sessionStamp).mockResolvedValue(now)
      expect((await current.sessions(home))[0]?.status).toBe('busy')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
