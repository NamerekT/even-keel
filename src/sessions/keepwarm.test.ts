import { describe, expect, it } from 'vitest'
import { emptyChainState, newChain, type ActiveChain } from '../chain/model.js'
import type { PullRequest } from '../review/model.js'
import type { TurnSpend } from '../state.js'
import { KeepWarm, warmStep, warmTasks, type KeepWarmDeps, type WarmFacts } from './keepwarm.js'
import type { WarmPing } from './warm-pings.js'

const HOUR = 60 * 60_000
const at = (time: string) => new Date(`2026-10-26T${time}:00.000Z`)

/** A session that answered at 12:00 and wrote an hour's cache. */
const facts = (over: Partial<WarmFacts> = {}): WarmFacts => ({
  task: 'ABC-1',
  sessionId: 'session-1',
  busy: false,
  onTool: false,
  ended: false,
  held: false,
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

  it('includes a session scheduled for a resume; warmStep still excludes real limits', () => {
    const current = { task: 'ABC-1', sessionId: 'session-1', since }
    const limit = { at: since, account: 'global', resetsAt: since, lastReplyAt: since, then: 'resume' as const, acted: null }
    expect(tasksOf([chain({ current: { ...current, limit } })])).toEqual([{ task: 'ABC-1', sessionId: 'session-1' }])
  })

  it('takes the new session of a handoff on a limit, never the handoff itself or a limit not acted on (BTN-1507)', () => {
    const current = { task: 'ABC-1', sessionId: 'session-2', since }
    const limit = { at: since, account: 'global', resetsAt: since, lastReplyAt: since, then: 'relay' as const, acted: 'relay' as const }
    expect(tasksOf([chain({ current: { ...current, limit } })])).toEqual([{ task: 'ABC-1', sessionId: 'session-2' }])
    expect(tasksOf([chain({ current: { ...current, limit, starting: since } })])).toEqual([])
    expect(tasksOf([chain({ current: { ...current, limit: { ...limit, acted: null } } })])).toEqual([])
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

  it('pings a five-minute cache a minute and a half before it goes cold', () => {
    const short = facts({ cache: { ttl: '5m', until: '2026-10-26T12:05:00.000Z' } })
    expect(warmStep(short, undefined, at('12:03'), 8 * HOUR)).toBe('wait')
    expect(warmStep(short, undefined, at('12:04'), 8 * HOUR)).toBe('ping')
  })

  it('leaves a cold cache alone, and names one it would still have pinged (BTN-1527)', () => {
    expect(warmStep(facts(), undefined, at('13:00'), 8 * HOUR)).toBe('cold')
    expect(warmStep(facts({ busy: true }), undefined, at('13:00'), 8 * HOUR)).toBe('wait')
    expect(warmStep(facts(), undefined, at('13:00'), HOUR)).toBe('wait')
    expect(warmStep(facts({ cache: null }), undefined, at('12:58'), 8 * HOUR)).toBe('wait')
  })

  it('pings ahead of a planned stop a cache that would go cold within it (BTN-1527)', () => {
    const short = facts({ cache: { ttl: '5m', until: '2026-10-26T12:05:00.000Z' } })
    expect(warmStep(short, undefined, new Date('2026-10-26T12:00:59.000Z'), 8 * HOUR, 4 * 60_000)).toBe('wait')
    expect(warmStep(short, undefined, at('12:01'), 8 * HOUR, 4 * 60_000)).toBe('ping')
    expect(warmStep(facts(), undefined, at('12:54'), 8 * HOUR, 4 * 60_000)).toBe('wait')
    expect(warmStep({ ...short, held: true }, undefined, at('12:01'), 8 * HOUR, 4 * 60_000)).toBe('wait')
  })

  it('sends nothing mid-turn, held or on a limit', () => {
    expect(warmStep(facts({ busy: true }), undefined, at('12:58'), 8 * HOUR)).toBe('wait')
    expect(warmStep(facts({ held: true }), undefined, at('12:58'), 8 * HOUR)).toBe('wait')
    expect(warmStep(facts({ limited: true }), undefined, at('12:58'), 8 * HOUR)).toBe('wait')
  })

  it('pings a turn that waits on a long tool call by the same thresholds, unless it is held (EKR-142)', () => {
    const short = facts({ busy: true, onTool: true, cache: { ttl: '5m', until: '2026-10-26T12:05:00.000Z' } })
    expect(warmStep(short, undefined, at('12:03'), 8 * HOUR)).toBe('wait')
    expect(warmStep(short, undefined, at('12:04'), 8 * HOUR)).toBe('ping')
    expect(warmStep({ ...short, held: true }, undefined, at('12:04'), 8 * HOUR)).toBe('wait')
    expect(warmStep({ ...short, limited: true }, undefined, at('12:04'), 8 * HOUR)).toBe('wait')
    expect(warmStep(short, undefined, at('12:05'), 8 * HOUR)).toBe('cold')
  })

  it('pings a session whose turn ended while a background command or agent runs, unless held or limited (BTN-1507)', () => {
    const short = facts({ busy: true, ended: true, cache: { ttl: '5m', until: '2026-10-26T12:05:00.000Z' } })
    expect(warmStep(short, undefined, at('12:04'), 8 * HOUR)).toBe('ping')
    expect(warmStep({ ...short, held: true }, undefined, at('12:04'), 8 * HOUR)).toBe('wait')
    expect(warmStep({ ...short, limited: true }, undefined, at('12:04'), 8 * HOUR)).toBe('wait')
    expect(warmStep({ ...short, ended: false }, undefined, at('12:04'), 8 * HOUR)).toBe('wait')
  })

  it('pings a five-minute cache early enough for a usual restart to pass under it (BTN-1507)', () => {
    const short = facts({ cache: { ttl: '5m', until: '2026-10-26T12:05:00.000Z' } })
    expect(warmStep(short, undefined, new Date('2026-10-26T12:03:29.000Z'), 8 * HOUR)).toBe('wait')
    expect(warmStep(short, undefined, new Date('2026-10-26T12:03:30.000Z'), 8 * HOUR)).toBe('ping')
  })

  it('counts the cache warm from the last ping that read it', () => {
    const pinged = { stretch: '2026-10-26T12:00:00.000Z', pings: 1, warmedAt: '2026-10-26T12:56:00.000Z' }
    expect(warmStep(facts(), pinged, at('13:30'), 8 * HOUR)).toBe('wait')
    expect(warmStep(facts(), pinged, at('13:51'), 8 * HOUR)).toBe('ping')
    expect(warmStep(facts(), pinged, at('13:56'), 8 * HOUR)).toBe('cold')
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
  const setup = (answer: () => Promise<TurnSpend>, hours = 8, transcript?: KeepWarmDeps['transcript']) => {
    const clock = { now: at('12:56') }
    const sessions = [facts()]
    const pinged: string[] = []
    const lines: string[] = []
    const woken = { count: 0 }
    const keep = new KeepWarm({
      hours: () => hours,
      sessions: () => sessions,
      ping: (each) => {
        pinged.push(each.sessionId)
        lines.push('answered')
        return answer()
      },
      onWarm: () => woken.count++,
      now: () => clock.now,
      log: (line) => lines.push(line),
      ...(transcript !== undefined && { transcript }),
    })
    return { keep, clock, sessions, pinged, lines, woken }
  }

  const decisions = (lines: string[]) => lines.filter((line) => line.includes(' starts at '))

  it('logs the inputs of its decision as each ping starts (BTN-1394)', async () => {
    const file = { size: 4096, modifiedAt: '2026-10-26T12:00:01.000Z', lastEntryAt: '2026-10-26T12:00:00.500Z' }
    const { keep, clock, lines } = setup(async () => spend(30_000), 8, async () => file)
    await keep.check()
    expect(lines[0]).toBe(
      'keepwarm: ABC-1: the ping 1 of session-1 starts at 2026-10-26T12:56:00.000Z: cache 1h until 2026-10-26T13:00:00.000Z ' +
        'from the request at 2026-10-26T12:00:00.000Z; busy false, onTool false, ended false, held false, limited false; series none; ' +
        'transcript 4096 bytes, modified 2026-10-26T12:00:01.000Z, last entry 2026-10-26T12:00:00.500Z',
    )
    expect(lines[1]).toBe('answered')
    clock.now = at('13:51')
    await keep.check()
    expect(decisions(lines)[1]).toContain(
      'the ping 2 of session-1 starts at 2026-10-26T13:51:00.000Z: cache 1h until 2026-10-26T13:00:00.000Z from the request at ' +
        '2026-10-26T12:00:00.000Z; busy false, onTool false, ended false, held false, limited false; ' +
        'series stretch 2026-10-26T12:00:00.000Z, pings 1, warmed 2026-10-26T12:56:00.000Z; transcript 4096 bytes',
    )
  })

  it('still pings when the transcript file cannot be read, and says so in the line', async () => {
    const { keep, pinged, lines } = setup(async () => spend(30_000), 8, async () => {
      throw new Error('ENOENT')
    })
    await keep.check()
    expect(pinged).toEqual(['session-1'])
    expect(decisions(lines)[0]).toMatch(/; transcript unknown$/)
  })

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

  it('tries a failed ping again a few times before it turns itself off (BTN-1507)', async () => {
    const { keep, clock, pinged, lines } = setup(async () => {
      throw new Error('exited with 1: boom')
    })
    for (const time of ['12:56', '12:57', '12:58', '12:59']) {
      clock.now = at(time)
      await keep.check()
    }
    expect(pinged).toHaveLength(3)
    const failed = lines.filter((line) => line.includes('failed'))
    expect(failed).toHaveLength(3)
    expect(failed.filter((line) => line.includes('not kept warm until a restart'))).toHaveLength(1)
    expect(failed[2]).toContain('not kept warm until a restart')
  })

  it('counts the failures in a row only: a ping that reads the cache starts them over (BTN-1507)', async () => {
    let attempts = 0
    const { keep, clock, pinged } = setup(async () => {
      if (++attempts === 3) return spend(30_000)
      throw new Error('exited with 1: boom')
    })
    for (const time of ['12:56', '12:57', '12:58', '13:53', '13:54', '13:55', '13:56']) {
      clock.now = at(time)
      await keep.check()
    }
    expect(pinged).toHaveLength(6)
  })

  describe('after a restart (BTN-1507)', () => {
    const kept = (at: string, cacheRead = 30_000, cacheWrite = 100): WarmPing => ({
      ...{ at: `2026-10-26T${at}:00.000Z`, sessionId: 'session-1', task: 'ABC-1', project: null, account: 'global', model: null },
      ...{ input: 2, cacheWrite5m: 0, cacheWrite1h: cacheWrite, cacheRead, output: 1 },
    })

    it('goes on with the series the kept pings name', async () => {
      const { keep, clock, pinged, lines } = setup(async () => spend(30_000))
      keep.restore([kept('12:56'), kept('13:51')])
      clock.now = at('14:46')
      await keep.check()
      expect(pinged).toEqual(['session-1'])
      expect(decisions(lines)[0]).toContain('the ping 3 of session-1')
      expect(keep.kept('session-1', facts().cache)).toEqual({ at: '2026-10-26T14:46:00.000Z', pings: 3 })
    })

    it('tells the page and the handoff the restored series before the next ping', async () => {
      const { keep, clock } = setup(async () => spend(30_000))
      keep.restore([kept('12:56')])
      clock.now = at('13:10')
      await keep.check()
      expect(keep.warmedAt('session-1')).toBe('2026-10-26T12:56:00.000Z')
    })

    it('leaves out the pings of an earlier stretch of idleness', async () => {
      const { keep, lines } = setup(async () => spend(30_000))
      keep.restore([kept('11:30')])
      await keep.check()
      expect(decisions(lines)[0]).toContain('the ping 1 of session-1')
    })

    it('counts the kept pings toward the break-even', async () => {
      const { keep, clock, pinged } = setup(async () => spend(30_000), 24)
      keep.restore(Array.from({ length: 20 }, (_, n) => kept(`12:${String(30 + n).padStart(2, '0')}`)))
      clock.now = at('13:45')
      await keep.check()
      expect(pinged).toEqual([])
    })

    it('stays off for a session whose last kept ping missed the cache', async () => {
      const { keep, pinged } = setup(async () => spend(30_000))
      keep.restore([kept('12:10'), kept('12:20', 1_000, 29_000)])
      await keep.check()
      expect(pinged).toEqual([])
    })

    describe('through a stop longer than the margin (BTN-1527)', () => {
      const short = (): WarmFacts => facts({ cache: { ttl: '5m', until: '2026-10-26T12:05:00.000Z' } })
      const time = (clock: string) => new Date(`2026-10-26T${clock}.000Z`)
      const cut = (lines: string[]) => lines.filter((line) => line.includes('went cold'))

      it('goes on when the ping ahead of the stop outlasts it', async () => {
        const before = setup(async () => spend(30_000))
        before.sessions[0] = short()
        before.clock.now = time('12:02:00')
        expect(await before.keep.ahead(4 * 60_000)).toBe(1)
        // Down 130 s, the facts 40 s after `listening`: the new process knows the session at 12:04:50.
        const after = setup(async () => spend(30_000))
        after.sessions.length = 0
        after.keep.restore([kept('12:02')])
        after.clock.now = time('12:04:10')
        await after.keep.check()
        after.sessions.push(short())
        after.clock.now = time('12:05:30')
        await after.keep.check()
        expect(after.pinged).toEqual(['session-1'])
        expect(decisions(after.lines)[0]).toContain('the ping 2 of session-1')
        expect(cut(after.lines)).toEqual([])
      })

      it('logs once that the series was cut when the cache went cold before the first check that knew the session', async () => {
        const { keep, clock, sessions, pinged, lines } = setup(async () => spend(30_000))
        sessions.length = 0
        keep.restore([kept('12:03')])
        clock.now = time('12:07:20')
        await keep.check()
        sessions.push(short())
        clock.now = time('12:08:10')
        await keep.check()
        clock.now = time('12:08:15')
        await keep.check()
        expect(pinged).toEqual([])
        expect(cut(lines)).toEqual([
          'keepwarm: ABC-1: the cache of session-1 went cold at 2026-10-26T12:08:00.000Z unpinged: its ping was due from ' +
            '2026-10-26T12:06:30.000Z, and the first check that knew the session came at 2026-10-26T12:08:10.000Z, ' +
            'the checks having begun at 2026-10-26T12:07:20.000Z: the series ends',
        ])
      })

      it('says nothing of a session a check knew while it could be pinged', async () => {
        const { keep, clock, sessions, lines } = setup(async () => spend(30_000))
        sessions[0] = facts({ held: true })
        clock.now = at('12:54')
        await keep.check()
        sessions[0] = facts()
        clock.now = at('13:01')
        await keep.check()
        expect(cut(lines)).toEqual([])
      })

      it('says nothing of a session that came long after the checks began, as a chain resumed', async () => {
        const { keep, clock, sessions, lines } = setup(async () => spend(30_000))
        sessions.length = 0
        clock.now = at('10:00')
        await keep.check()
        sessions.push(facts())
        clock.now = at('13:01')
        await keep.check()
        expect(cut(lines)).toEqual([])
      })
    })
  })

  it('waits ahead of a stop for the pings in flight too (BTN-1527)', async () => {
    let finish: (value: TurnSpend) => void = () => {}
    const { keep, pinged } = setup(() => new Promise((resolve) => (finish = resolve)))
    const first = keep.check()
    let done = false
    const ahead = keep.ahead(4 * 60_000).then((count) => {
      done = true
      return count
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(done).toBe(false)
    finish(spend(30_000))
    expect(await ahead).toBe(0)
    await first
    expect(pinged).toHaveLength(1)
    expect(keep.warmedAt('session-1')).toBe('2026-10-26T12:56:00.000Z')
  })

  it('pings nothing ahead of a stop while it is off', async () => {
    const { keep, pinged } = setup(async () => spend(30_000), 0)
    expect(await keep.ahead(4 * 60_000)).toBe(0)
    expect(pinged).toEqual([])
  })

  it('skips an overloaded ping and can keep the cache warm when the provider recovers', async () => {
    let attempts = 0
    const { keep, clock, pinged, lines } = setup(async () => {
      if (++attempts === 1) throw new Error('API Error: 529 overloaded_error')
      return spend(30_000)
    })
    await keep.check()
    expect(keep.warmedAt('session-1')).toBeNull()
    clock.now = at('12:57')
    await keep.check()
    expect(pinged).toHaveLength(2)
    expect(keep.warmedAt('session-1')).toBe('2026-10-26T12:57:00.000Z')
    expect(lines.find((line) => line.includes('skipped'))).toContain('529 overloaded_error')
  })

  it('tells the page the pings of the current stretch of idleness and wakes it on each (EKR-143)', async () => {
    const { keep, clock, woken } = setup(async () => spend(30_000))
    const cache = facts().cache
    expect(keep.kept('session-1', cache)).toBeNull()
    await keep.check()
    clock.now = at('13:51')
    await keep.check()
    expect(keep.kept('session-1', cache)).toEqual({ at: '2026-10-26T13:51:00.000Z', pings: 2 })
    expect(woken.count).toBe(2)
    expect(keep.kept('session-1', { ttl: '1h', until: '2026-10-26T14:30:00.000Z' })).toBeNull()
    expect(keep.kept('session-1', null)).toBeNull()
    expect(keep.kept('session-2', cache)).toBeNull()
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
