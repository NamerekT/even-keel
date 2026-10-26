import { describe, expect, it } from 'vitest'
import { emptyChainState, newChain, type ActiveChain } from '../chain/model.js'
import type { PullRequest } from '../review/model.js'
import type { TurnSpend } from '../state.js'
import { KeepWarm, warmStep, warmTasks, type WarmFacts } from './keepwarm.js'

const HOUR = 60 * 60_000
const at = (time: string) => new Date(`2026-10-26T${time}:00.000Z`)

/** A session that answered at 12:00 and wrote an hour's cache. */
const facts = (over: Partial<WarmFacts> = {}): WarmFacts => ({
  task: 'ABC-1',
  sessionId: 'session-1',
  busy: false,
  limited: false,
  cache: { ttl: '1h', until: '2026-10-26T13:00:00.000Z' },
  ...over,
})

const spend = (cacheRead: number, cacheWrite = 100, input = 2): TurnSpend => ({
  model: 'claude-haiku',
  tokens: { input, output: 1, cacheRead, cacheWrite },
  cost: null,
  durationMs: 1000,
})

describe('warmTasks', () => {
  const since = '2026-10-26T12:00:00.000Z'
  const chain = (over: Partial<ActiveChain> = {}): ActiveChain => ({ ...newChain('id-abc'), current: { task: 'ABC-1', sessionId: 'session-1', since }, ...over })
  const pull = (task: string, over: Partial<PullRequest> = {}): PullRequest => ({
    ...{ task, remote: 'origin', number: 7, url: 'https://forge.example.com/pull/7', branch: `${task.toLowerCase()}/task` },
    ...{ at: since, pushedAt: since, markAt: null, seen: [] },
    ...over,
  })
  const tasksOf = (chains: ActiveChain[], reviews: PullRequest[] = []) => warmTasks({ ...emptyChainState(), active: chains, reviews: { 'id-abc': reviews } })

  it('takes the session the running chain leads with', () => {
    expect(tasksOf([chain()])).toEqual([{ task: 'ABC-1', sessionId: 'session-1' }])
  })

  it('takes none while the task starts, is moved or waits on a limit', () => {
    const current = { task: 'ABC-1', sessionId: 'session-1', since }
    expect(tasksOf([chain({ current: { ...current, starting: since } })])).toEqual([])
    expect(tasksOf([chain({ current: { ...current, sessionId: null } })])).toEqual([])
    const limit = { at: since, account: null, resetsAt: null, lastReplyAt: null, then: 'relay' as const, acted: null }
    expect(tasksOf([chain({ current: { ...current, limit } })])).toEqual([])
    expect(tasksOf([chain({ limitUntil: since })])).toEqual([])
  })

  it('takes none of a paused or halted chain', () => {
    expect(tasksOf([chain({ paused: true })], [pull('ABC-2')])).toEqual([])
    expect(tasksOf([chain({ error: { code: 'chain.midTurn', params: { task: 'ABC-1' } } })])).toEqual([])
  })

  it('takes the tasks waiting on their open pull request, by whichever session is live', () => {
    const reviews = [pull('ABC-2'), pull('ABC-3', { closed: 'merged' }), pull('ABC-1')]
    expect(tasksOf([chain()], reviews)).toEqual([
      { task: 'ABC-1', sessionId: 'session-1' },
      { task: 'ABC-2', sessionId: null },
    ])
    expect(tasksOf([], reviews)).toEqual([])
  })
})

describe('warmStep', () => {
  it('pings an hour cache five minutes before it goes cold', () => {
    expect(warmStep(facts(), undefined, at('12:54'), 8 * HOUR)).toBe('wait')
    expect(warmStep(facts(), undefined, at('12:55'), 8 * HOUR)).toBe('ping')
  })

  it('pings a five-minute cache a minute before it goes cold', () => {
    const short = facts({ cache: { ttl: '5m', until: '2026-10-26T12:05:00.000Z' } })
    expect(warmStep(short, undefined, at('12:03'), 8 * HOUR)).toBe('wait')
    expect(warmStep(short, undefined, at('12:04'), 8 * HOUR)).toBe('ping')
  })

  it('leaves a cold cache alone', () => {
    expect(warmStep(facts(), undefined, at('13:00'), 8 * HOUR)).toBe('wait')
    expect(warmStep(facts({ cache: null }), undefined, at('12:58'), 8 * HOUR)).toBe('wait')
  })

  it('sends nothing mid-turn or on a limit', () => {
    expect(warmStep(facts({ busy: true }), undefined, at('12:58'), 8 * HOUR)).toBe('wait')
    expect(warmStep(facts({ limited: true }), undefined, at('12:58'), 8 * HOUR)).toBe('wait')
  })

  it('counts the cache warm from the last ping that read it', () => {
    const pinged = { stretch: '2026-10-26T12:00:00.000Z', pings: 1, warmedAt: '2026-10-26T12:56:00.000Z' }
    expect(warmStep(facts(), pinged, at('13:30'), 8 * HOUR)).toBe('wait')
    expect(warmStep(facts(), pinged, at('13:51'), 8 * HOUR)).toBe('ping')
    expect(warmStep(facts(), pinged, at('13:56'), 8 * HOUR)).toBe('wait')
  })

  it('forgets the pings of an earlier stretch once the session answered again', () => {
    const old = { stretch: '2026-10-26T09:00:00.000Z', pings: 20, warmedAt: '2026-10-26T11:56:00.000Z' }
    expect(warmStep(facts(), old, at('12:55'), 8 * HOUR)).toBe('ping')
  })

  it('stops at the idle ceiling counted from the last real answer', () => {
    const pinged = { stretch: '2026-10-26T12:00:00.000Z', pings: 2, warmedAt: '2026-10-26T13:50:00.000Z' }
    expect(warmStep(facts(), pinged, at('14:45'), 3 * HOUR)).toBe('ping')
    expect(warmStep(facts(), pinged, at('14:45'), 2 * HOUR)).toBe('wait')
  })

  it('stops once more pings than a miss costs were sent', () => {
    const hour = (pings: number) => ({ stretch: '2026-10-26T12:00:00.000Z', pings, warmedAt: '2026-10-26T12:56:00.000Z' })
    expect(warmStep(facts(), hour(19), at('13:51'), 24 * HOUR)).toBe('ping')
    expect(warmStep(facts(), hour(20), at('13:51'), 24 * HOUR)).toBe('wait')
    const short = facts({ cache: { ttl: '5m', until: '2026-10-26T12:05:00.000Z' } })
    const five = (pings: number) => ({ stretch: '2026-10-26T12:00:00.000Z', pings, warmedAt: '2026-10-26T12:04:00.000Z' })
    expect(warmStep(short, five(11), at('12:08'), 24 * HOUR)).toBe('ping')
    expect(warmStep(short, five(12), at('12:08'), 24 * HOUR)).toBe('wait')
  })
})

describe('KeepWarm', () => {
  const setup = (answer: () => Promise<TurnSpend>, hours = 8) => {
    const clock = { now: at('12:56') }
    const sessions = [facts()]
    const pinged: string[] = []
    const lines: string[] = []
    const keep = new KeepWarm({
      hours: () => hours,
      sessions: () => sessions,
      ping: (each) => {
        pinged.push(each.sessionId)
        return answer()
      },
      now: () => clock.now,
      log: (line) => lines.push(line),
    })
    return { keep, clock, pinged, lines }
  }

  it('sends nothing while it is off', async () => {
    const { keep, pinged } = setup(async () => spend(30_000), 0)
    await keep.check()
    expect(pinged).toEqual([])
  })

  it('keeps the cache warm from a ping that read it', async () => {
    const { keep, clock, pinged, lines } = setup(async () => spend(30_000))
    await keep.check()
    expect(pinged).toEqual(['session-1'])
    expect(keep.warmedAt('session-1')).toBe('2026-10-26T12:56:00.000Z')
    expect(lines.join('\n')).toContain('read 30000 of 30102')
    clock.now = at('12:57')
    await keep.check()
    expect(pinged).toHaveLength(1)
    clock.now = at('13:51')
    await keep.check()
    expect(pinged).toHaveLength(2)
    expect(keep.warmedAt('session-1')).toBe('2026-10-26T13:51:00.000Z')
  })

  it('turns itself off for the session after a miss', async () => {
    const { keep, clock, pinged, lines } = setup(async () => spend(1_000, 29_000))
    await keep.check()
    expect(keep.warmedAt('session-1')).toBeNull()
    expect(lines.join('\n')).toContain('missed')
    clock.now = at('12:58')
    await keep.check()
    expect(pinged).toHaveLength(1)
  })

  it('turns itself off for the session after an error', async () => {
    const { keep, clock, pinged, lines } = setup(async () => {
      throw new Error('the turn ended with error_max_turns')
    })
    await keep.check()
    expect(lines.join('\n')).toContain('error_max_turns')
    clock.now = at('12:58')
    await keep.check()
    expect(pinged).toHaveLength(1)
  })

  it('sends one ping at a time', async () => {
    let finish: (value: TurnSpend) => void = () => {}
    const { keep, pinged } = setup(() => new Promise((resolve) => (finish = resolve)))
    const first = keep.check()
    await keep.check()
    expect(pinged).toHaveLength(1)
    finish(spend(30_000))
    await first
    expect(keep.warmedAt('session-1')).toBe('2026-10-26T12:56:00.000Z')
  })
})
