import { describe, expect, it } from 'vitest'
import type { MachineFacts } from './facts.js'
import { allSessions, pageReads } from './page.js'
import type { SessionView } from '../state.js'

const session = (sessionId: string, task: string, patch: Partial<SessionView> = {}) =>
  ({ task, sessionId, agent: 'claude', model: 'opus', lamp: 'working', cwd: `/work/${task}`, account: null, ...patch }) as SessionView

const mirror = (facts: Partial<MachineFacts>) => pageReads(() => facts as MachineFacts)

describe('allSessions', () => {
  it("reads the sessions of every machine's mirror, the own one's first", () => {
    const own = mirror({ sessions: { a: session('a', 'ABC-1') } })
    const elsewhere = mirror({ sessions: { b: session('b', 'ABC-2', { lamp: 'waiting' }) } })
    const reads = allSessions(() => [own, elsewhere])
    expect(reads.sessions().map((view) => [view.sessionId, view.lamp])).toEqual([['a', 'working'], ['b', 'waiting']])
  })

  it('keeps a session two mirrors show once, as the first of them has it', () => {
    const own = mirror({ sessions: { a: session('a', 'ABC-1', { lamp: 'finished' }) } })
    const elsewhere = mirror({ sessions: { a: session('a', 'ABC-1', { lamp: 'working' }) } })
    expect(allSessions(() => [own, elsewhere]).sessions().map((view) => view.lamp)).toEqual(['finished'])
  })

  it('asks the account and the compactions of a session of the machine whose mirror knows it', () => {
    const own = mirror({ sessions: {}, compactions: {} })
    const elsewhere = mirror({ sessions: { b: session('b', 'ABC-2', { account: 'john.doe@example.com' }) }, compactions: { b: 2 } })
    const reads = allSessions(() => [own, elsewhere])
    expect(reads.sessionAccount('b', null)).toBe('john.doe@example.com')
    expect(reads.compactionsOf('b')).toBe(2)
    expect(reads.sessionAccount('none', null)).toBeNull()
    expect(reads.compactionsOf('none')).toBe(0)
  })
})
