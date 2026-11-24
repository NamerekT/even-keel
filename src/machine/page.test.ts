import { describe, expect, it } from 'vitest'
import type { MachineFacts } from './facts.js'
import { allSessions, pageReads, withHubMail } from './page.js'
import type { Mail } from '../sessions/mail.js'
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

  it("names an ended session's agent by the account folder its transcript is in (BTN-1341)", () => {
    const entry = (key: string, agent: string) => ({ key, agent, status: { email: 'john.doe@example.com' } })
    const panel = { accounts: [entry('claude-john', 'claude'), entry('codex-john', 'codex')] } as unknown as MachineFacts['panel']
    const own = mirror({ sessions: {}, owners: { gone: 'codex-john', lost: 'removed' }, panel })
    const elsewhere = mirror({ sessions: { live: session('live', 'ABC-2', { agent: 'opencode' }) } })
    const reads = allSessions(() => [own, elsewhere])
    expect(reads.sessionAgent('gone')).toBe('codex')
    expect(reads.sessionAgent('live')).toBe('opencode')
    expect(reads.sessionAgent('lost')).toBeNull()
    expect(reads.sessionAgent('none')).toBeNull()
  })

  it("reads the mailbox, the steering and the live view of a session elsewhere from its machine's mirror (BTN-1633)", () => {
    const own = mirror({ sessions: { a: session('a', 'ABC-1') }, mailbox: { a: { listens: true, steers: false, mail: [] } } })
    const elsewhere = mirror({ sessions: { b: session('b', 'ABC-2') }, mailbox: { b: { listens: true, steers: true, mail: [] } } })
    const reads = allSessions(() => [own, elsewhere])
    expect(Object.keys(reads.mailbox())).toEqual(['a', 'b'])
    expect(reads.steers('b')).toBe(true)
    expect(reads.steers('a')).toBe(false)
    expect(reads.liveView('ABC-2')?.sessionId).toBe('b')
    expect(reads.liveView('ABC-3')).toBeUndefined()
  })
})

describe('withHubMail', () => {
  const mail = (id: number, sessionId: string, postedAt: string): Mail =>
    ({ id, task: 'ABC-2', sessionId, text: 'Hi', files: [], postedAt, fate: 'waiting', event: null, reason: null, settledAt: null })
  const hub = (heard: string[], rows: Mail[]) => ({ listens: (id: string) => heard.includes(id), of: (id: string) => rows.filter((row) => row.sessionId === id) })

  it("lays the hub's own mail and ask over a session elsewhere, whose hooks ask the hub's page (BTN-1633)", () => {
    const told = mail(1, 'b', '2026-11-24T10:00:01.000Z')
    const waiting = mail(7, 'b', '2026-11-24T10:00:00.000Z')
    const box = withHubMail({ b: { listens: false, steers: false, mail: [told] } }, ['b', 'c', 'd'], hub(['c'], [waiting]))
    expect(box.b).toEqual({ listens: false, steers: false, mail: [waiting, told] })
    expect(box.c).toEqual({ listens: true, steers: false, mail: [] })
    expect(box.d).toBeUndefined()
  })

  it('leaves the sessions of the own machine as its mirror has them', () => {
    const box = withHubMail({ a: { listens: true, steers: false, mail: [] } }, [], hub(['a'], [mail(1, 'a', '2026-11-24T10:00:00.000Z')]))
    expect(box).toEqual({ a: { listens: true, steers: false, mail: [] } })
  })
})
