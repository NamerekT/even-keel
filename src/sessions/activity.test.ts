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
const stamp = (at: number) => written.mockResolvedValue({ mtimeMs: at } as Awaited<ReturnType<typeof stat>>)

beforeEach(() => vi.resetAllMocks())

describe('turn activity across file-based agents', () => {
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
