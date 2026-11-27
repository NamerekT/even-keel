import { describe, expect, it } from 'vitest'
import type { TaskSession } from '../../../src/chain/launches.js'
import type { EventEntry } from '../../../src/event-log/model.js'
import type { SessionView } from '../../../src/state.js'
import type { ChainBlock } from '../state.js'
import { withOlder } from './EventLogPage.js'
import { asksHistory, withHistory } from './taskHistory.js'

const run = (sessionId: string, at: string): TaskSession => ({ sessionId, at, how: 'launch', resumed: 0, answers: 0 })
const block = (over: Partial<ChainBlock>) => ({ id: 'ABC-1', session: null, sessions: [], ...over }) as ChainBlock
const entry = (id: number) => ({ id: String(id), at: '2026-11-17T10:00:00Z', level: 'info', notice: { code: 'eventLog.limit', params: {} }, place: null }) as EventEntry

describe('withHistory', () => {
  it('gives a block the state left bare its runs and the session of the newest run', () => {
    const newest = { task: 'ABC-1', sessionId: 's2', lamp: 'finished' } as SessionView
    const runs = [run('s2', '2026-11-02T00:00:00Z'), run('s1', '2026-11-01T00:00:00Z')]
    const shown = withHistory(block({}), { runs, sessions: [{ ...newest, sessionId: 's1' }, newest] })
    expect(shown.sessions).toBe(runs)
    expect(shown.session).toBe(newest)
  })

  it('leaves a block the state gave runs and their session as it is', () => {
    const given = block({ sessions: [run('s3', '2026-11-16T00:00:00Z')], session: { task: 'ABC-1', sessionId: 's3' } as SessionView })
    expect(withHistory(given, { runs: [run('s1', '2026-11-01T00:00:00Z')], sessions: [] })).toBe(given)
  })

  it('gives a block the state gave runs without their session the session of its newest run (BTN-1561)', () => {
    const runs = [run('s3', '2026-11-16T00:00:00Z')]
    const newest = { task: 'ABC-1', sessionId: 's3', lamp: 'finished' } as SessionView
    const shown = withHistory(block({ sessions: runs }), { runs: [run('s3', '2026-11-16T00:00:00Z'), run('s1', '2026-11-01T00:00:00Z')], sessions: [newest] })
    expect(shown.sessions).toBe(runs)
    expect(shown.session).toBe(newest)
  })

  it('gives the runs the state gave without an account the account, agent and compactions the history found (BTN-1800)', () => {
    const newest = { task: 'ABC-1', sessionId: 's3' } as SessionView
    const given = block({ sessions: [{ ...run('s3', '2026-11-16T02:00:00Z'), account: 'a@example.com' }, run('s2', '2026-11-16T01:00:00Z')], session: newest })
    const found = [run('s3', '2026-11-16T02:00:00Z'), { ...run('s2', '2026-11-16T01:00:00Z'), account: 'b@example.com', agent: 'claude', compactions: 2 }]
    const shown = withHistory(given, { runs: found, sessions: [] })
    expect(shown.session).toBe(newest)
    expect(shown.sessions).toEqual([given.sessions[0], { ...given.sessions[1], account: 'b@example.com', agent: 'claude', compactions: 2 }])
  })
})

describe('asksHistory', () => {
  it('asks for a task with a run whose account the state does not know (BTN-1800)', () => {
    const session = { task: 'ABC-1', sessionId: 's3' } as SessionView
    expect(asksHistory(block({ sessions: [{ ...run('s3', '2026-11-16T00:00:00Z'), account: 'a@example.com' }], session }), undefined)).toBe(false)
    expect(asksHistory(block({ sessions: [run('s3', '2026-11-16T00:00:00Z')], session }), undefined)).toBe(true)
  })

  it('asks for a task named in ranAt and for one with runs and no session', () => {
    expect(asksHistory(block({}), '2026-11-01T00:00:00Z')).toBe(true)
    expect(asksHistory(block({}), undefined)).toBe(false)
    expect(asksHistory(block({ sessions: [{ ...run('s3', '2026-11-16T00:00:00Z'), account: 'a@example.com' }] }), undefined)).toBe(true)
  })
})

describe('withOlder', () => {
  it('puts the older entries of the whole log before the state’s newest ones', () => {
    const recent = [entry(4), entry(5)]
    expect(withOlder([entry(1), entry(2), entry(3), entry(4)], recent).map((each) => each.id)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('shows the state’s entries while the whole log has not come', () => {
    expect(withOlder([], [entry(4)]).map((each) => each.id)).toEqual(['4'])
  })
})
