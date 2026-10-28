import { stat } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnActivity } from './activity.js'
import type { AgentEntry } from './agents.js'
import type { SessionTail } from '../agent/contract.js'
import { TURN_HANG_MS } from './silence.js'

vi.mock('node:fs/promises', () => ({ stat: vi.fn() }))
const written = vi.mocked(stat)
const now = Date.parse('2026-10-27T12:00:00Z')
const entry: AgentEntry = { sessionId: 'session', pid: 123, startedAt: now - 3_600_000, cwd: '/work', kind: 'test', status: 'busy' }
const tail = { path: '/work/transcript.jsonl' } as SessionTail
const stamp = (at: number, size = 100) => written.mockResolvedValue({ mtimeMs: at, size } as Awaited<ReturnType<typeof stat>>)

beforeEach(() => vi.resetAllMocks())

describe('turn activity across file-based agents', () => {
  it.each(['claude', 'codex', 'copilot'])('keeps a growing %s transcript active with a frozen modification time', async (kind) => {
    const activity = new TurnActivity()
    const agent = { ...entry, kind }
    stamp(now, 100)
    await activity.read(agent, tail, now)
    for (let minute = 1; minute <= 35; minute++) {
      stamp(now, 100 + minute)
      expect(await activity.read(agent, tail, now + minute * 60_000)).toMatchObject({ status: 'busy', silentSince: now + minute * 60_000 })
    }
    expect(await activity.read(agent, tail, now + 65 * 60_000)).toMatchObject({ status: 'idle', hungSince: now + 35 * 60_000 })
  })

  it.each(['claude', 'codex', 'copilot'])('uses every transcript write for %s, including invisible streaming records', async (kind) => {
    const activity = new TurnActivity()
    stamp(now - TURN_HANG_MS)
    expect(await activity.read({ ...entry, kind }, tail, now)).toMatchObject({ status: 'idle', hungSince: now - TURN_HANG_MS })
    stamp(now)
    expect(await activity.read({ ...entry, kind }, tail, now)).toMatchObject({ status: 'busy', silentSince: now })
  })

  it('resets silence when a resting session resumes and when its process changes', async () => {
    const activity = new TurnActivity()
    stamp(now - TURN_HANG_MS)
    await activity.read({ ...entry, status: 'idle' }, tail, now - 1)
    expect(await activity.read(entry, tail, now)).toMatchObject({ status: 'busy', silentSince: now })
    expect(await activity.read({ ...entry, pid: 456 }, tail, now + 1)).toMatchObject({ silentSince: now + 1 })
  })

  it('bounds old transcript writes by the current process start after a service restart', async () => {
    stamp(now - TURN_HANG_MS)
    expect(await new TurnActivity().read({ ...entry, processStartedAt: now }, tail, now)).toMatchObject({ status: 'busy', silentSince: now })
  })

  it('counts truncation and a replaced transcript path as activity', async () => {
    const activity = new TurnActivity()
    stamp(now, 100)
    await activity.read(entry, tail, now)
    stamp(now, 10)
    expect(await activity.read(entry, tail, now + 60_000)).toMatchObject({ silentSince: now + 60_000 })
    const replacement = { path: '/work/replaced.jsonl' } as SessionTail
    expect(await activity.read(entry, replacement, now + 120_000)).toMatchObject({ silentSince: now + 120_000 })
  })

  it('keeps observed growth through a stat failure and ignores a backwards mtime', async () => {
    const activity = new TurnActivity()
    stamp(now, 100)
    await activity.read(entry, tail, now)
    stamp(now, 200)
    await activity.read(entry, tail, now + 60_000)
    written.mockRejectedValueOnce(new Error('temporarily unavailable'))
    expect(await activity.read(entry, tail, now + 90_000)).toEqual(entry)
    stamp(now - 60_000, 200)
    expect(await activity.read(entry, tail, now + 120_000)).toMatchObject({ silentSince: now + 60_000 })
  })

  it('forgets removed sessions so a reused id gets no stale file activity', async () => {
    const activity = new TurnActivity()
    stamp(now, 100)
    await activity.read(entry, tail, now)
    stamp(now, 200)
    await activity.read(entry, tail, now + 60_000)
    activity.sweep(new Set([entry.sessionId]))
    expect(await activity.read(entry, tail, now + 90_000)).toMatchObject({ silentSince: now + 60_000 })
    activity.sweep(new Set())
    expect(await activity.read(entry, tail, now + 120_000)).toMatchObject({ silentSince: now })
  })

  it('preserves OpenCode activity and treats unreadable sources as unknown', async () => {
    const activity = new TurnActivity()
    const openCode = { ...entry, silentSince: now - 60_000 }
    expect(await activity.read(openCode, { path: undefined } as SessionTail, now)).toEqual(openCode)
    written.mockRejectedValue(new Error('temporarily unavailable'))
    expect(await activity.read(entry, tail, now)).toEqual(entry)
    expect(await activity.read(entry, { path: undefined } as SessionTail, now)).toEqual(entry)
  })

  it.each(['shell', 'waiting', 'idle'] as const)('leaves %s and process-free Codex rests alone', async (status) => {
    stamp(now - TURN_HANG_MS)
    const agent = { ...entry, status }
    expect(await new TurnActivity().read(agent, tail, now)).toEqual(agent)
    const resting = { ...entry, pid: undefined, resting: true }
    expect(await new TurnActivity().read(resting, tail, now)).toEqual(resting)
  })
})
