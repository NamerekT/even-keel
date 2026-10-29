import { describe, expect, it } from 'vitest'
import { textNotice } from '../notice/notice.js'
import { active, pause, setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { type Dispatcher } from './dispatcher.js'
import { warmCacheMs, type LimitedSession } from './relay.js'

describe('Dispatcher on a limit', () => {
  const limitedSession = (sessionId: string, at: string, lastReplyAt: string): LimitedSession => ({
    sessionId,
    agentId: sessionId.slice(0, 8),
    account: 'global',
    cwd: 'D:/work/abc',
    workdir: 'D:/work/abc/.claude/worktrees/abc-1',
    branch: 'abc-1/work',
    transcript: null,
    limit: { at, text: "You've hit your session limit · resets 3pm (UTC)" },
    lastReplyAt,
    recent: [],
    lastMessage: null,
    checkpoint: null,
  })

  async function running(options: SetupOptions = {}) {
    const context = setup(options)
    context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    context.dispatcher.start('ABC')
    await context.dispatcher.idle()
    return context
  }

  async function check(dispatcher: Dispatcher) {
    dispatcher.check()
    await dispatcher.idle()
  }

  it('remembers the limit and waits for the reset', async () => {
    const { dispatcher, limited, clock, relays } = await running()
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    await check(dispatcher)

    expect(relays).toEqual([])
    expect(dispatcher.state.active[0]?.current?.limit).toEqual({
      at: '2026-09-26T12:00:00.000Z',
      account: 'john@example.com',
      resetsAt: '2026-09-26T15:00:00.000Z',
      lastReplyAt: '2026-09-26T11:59:00.000Z',
      then: 'relay',
      acted: null,
    })

    clock.now = new Date('2026-09-26T14:59:00Z')
    await check(dispatcher)
    expect(relays).toEqual([])
  })

  it('learns the reset of a limit without a reset time from the limits polled later and hands over after it', async () => {
    const polled: { reset: string | null; asked: string[] } = { reset: null, asked: [] }
    const limitResetAfter = (account: string, at: string) => {
      polled.asked.push(`${account} ${at}`)
      return polled.reset
    }
    const { dispatcher, limited, clock, relays } = await running({ limitResetAfter })
    limited['ABC-1'] = {
      ...limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z'),
      limit: { at: '2026-09-26T12:00:00.000Z', text: 'Usage limit reached; a short grace allowance remains' },
    }
    await check(dispatcher)
    expect(dispatcher.state.active[0]?.current?.limit?.resetsAt).toBeNull()

    clock.now = new Date('2026-09-26T12:05:00Z')
    polled.reset = '2026-09-26T14:00:00.000Z'
    await check(dispatcher)
    expect(dispatcher.state.active[0]?.current?.limit).toMatchObject({ resetsAt: '2026-09-26T14:00:00.000Z', acted: null })
    expect(polled.asked.at(-1)).toBe('global 2026-09-26T12:00:00.000Z')
    expect(relays).toEqual([])

    clock.now = new Date('2026-09-26T14:01:00Z')
    await check(dispatcher)
    expect(relays).toMatchObject([{ kind: 'relay', task: 'ABC-1', sessionId: 'session-1' }])
  })

  it('continues an API session once its key has credit again, by the five-minute cache of the key', async () => {
    const credit = { back: null as string | null }
    const out = (lastReplyAt: string) => ({
      ...limitedSession('session-1', '2026-09-26T12:00:00.000Z', lastReplyAt),
      limit: { at: '2026-09-26T12:00:00.000Z', text: 'Credit balance is too low' },
      warmMs: warmCacheMs('5m'),
    })
    const warm = await running({ limitResetAfter: () => credit.back })
    warm.limited['ABC-1'] = out('2026-09-26T11:59:00.000Z')
    await check(warm.dispatcher)
    expect(warm.dispatcher.state.active[0]?.current?.limit?.resetsAt).toBeNull()

    warm.clock.now = new Date('2026-09-26T12:02:00Z')
    credit.back = '2026-09-26T12:01:00.000Z'
    await check(warm.dispatcher)
    expect(warm.relays).toMatchObject([{ kind: 'resume', sessionId: 'session-1' }])

    credit.back = null
    const cold = await running({ limitResetAfter: () => credit.back })
    cold.limited['ABC-1'] = out('2026-09-26T11:59:00.000Z')
    await check(cold.dispatcher)
    cold.clock.now = new Date('2026-09-26T12:31:00Z')
    credit.back = '2026-09-26T12:30:00.000Z'
    await check(cold.dispatcher)
    expect(cold.relays).toMatchObject([{ kind: 'relay', task: 'ABC-1', sessionId: 'session-1' }])
  })

  it('hands the task to a new session in the old worktree once the limit resets with a cold cache', async () => {
    const { dispatcher, limited, clock, relays, journal } = await running()
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    await check(dispatcher)

    clock.now = new Date('2026-09-26T15:01:00Z')
    await check(dispatcher)

    expect(relays).toMatchObject([{ kind: 'relay', task: 'ABC-1', sessionId: 'session-1' }])
    expect(relays[0]?.prompt).toContain('D:/work/abc/.claude/worktrees/abc-1')
    expect(dispatcher.state.active[0]?.current).toMatchObject({ task: 'ABC-1', sessionId: 'session-2', since: '2026-09-26T12:00:00.000Z' })
    expect(journal.at(-1)).toEqual({
      at: '2026-09-26T15:01:00.000Z',
      project: 'ABC',
      task: 'ABC-1',
      sessionId: 'session-2',
      reason: 'relay',
      cause: 'limit',
      previous: 'session-1',
    })

    await check(dispatcher)
    expect(relays).toHaveLength(1)
  })

  it('resumes the same session when the limit resets while its cache is warm', async () => {
    const { dispatcher, limited, clock, relays, journal } = await running()
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T14:30:00.000Z', '2026-09-26T14:29:00.000Z')
    await check(dispatcher)
    expect(dispatcher.state.active[0]?.current?.limit?.then).toBe('resume')

    clock.now = new Date('2026-09-26T15:01:10Z')
    await check(dispatcher)

    expect(relays).toMatchObject([{ kind: 'resume', sessionId: 'session-1' }])
    expect(dispatcher.state.active[0]?.current?.sessionId).toBe('session-1')
    expect(journal.at(-1)).toMatchObject({ sessionId: 'session-1', reason: 'resume', previous: 'session-1' })

    await check(dispatcher)
    expect(relays).toHaveLength(1)
  })

  it('hands over before the reset when the account was switched', async () => {
    const { dispatcher, limited, clock, relays, account } = await running()
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    await check(dispatcher)

    account.id = 'jane@example.com'
    clock.now = new Date('2026-09-26T12:05:00Z')
    await check(dispatcher)
    expect(relays).toMatchObject([{ kind: 'relay' }])
  })

  it('hands over when the account was switched on a paused chain before the limit was noted', async () => {
    const accountAt = (_account: string, at: string) => (at < '2026-09-26T12:03:00.000Z' ? 'john@example.com' : 'jane@example.com')
    const { dispatcher, limited, clock, relays, account } = await running({ accountAt })
    pause(dispatcher, 'ABC')
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    account.id = 'jane@example.com'
    clock.now = new Date('2026-09-26T12:05:00Z')
    dispatcher.resume('ABC')
    await dispatcher.idle()

    expect(dispatcher.state.active[0]?.current?.limit?.account).toBe('john@example.com')
    expect(relays).toMatchObject([{ kind: 'relay' }])
  })

  it('waits to note a limit until the account is known', async () => {
    const { dispatcher, limited, account } = await running({ accountAt: () => null })
    account.id = null
    account.ready = false
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    await check(dispatcher)
    expect(dispatcher.state.active[0]?.current?.limit).toBeUndefined()
  })

  it('acts again on a new limit of the relayed session', async () => {
    const { dispatcher, limited, clock, relays } = await running()
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    await check(dispatcher)
    clock.now = new Date('2026-09-26T15:01:00Z')
    await check(dispatcher)

    limited['ABC-1'] = limitedSession('session-2', '2026-09-26T16:00:00.000Z', '2026-09-26T15:59:00.000Z')
    clock.now = new Date('2026-09-26T16:00:00Z')
    await check(dispatcher)
    expect(dispatcher.state.active[0]?.current?.limit).toMatchObject({ at: '2026-09-26T16:00:00.000Z', acted: null })

    clock.now = new Date('2026-09-27T15:01:00Z')
    await check(dispatcher)
    expect(relays.map((relay) => relay.sessionId)).toEqual(['session-1', 'session-2'])
  })

  it('forgets the limit once the session answers again', async () => {
    const { dispatcher, limited } = await running()
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    await check(dispatcher)

    delete limited['ABC-1']
    await check(dispatcher)
    expect(dispatcher.state.active[0]?.current?.limit).toBeUndefined()
  })

  it('leaves a paused chain alone', async () => {
    const { dispatcher, limited, clock, relays } = await running()
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    pause(dispatcher, 'ABC')
    clock.now = new Date('2026-09-26T16:00:00Z')
    await check(dispatcher)
    expect(relays).toEqual([])
  })

  it('pauses the chain when the handover fails', async () => {
    const { dispatcher, limited, clock } = await running({ failRelay: true })
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    await check(dispatcher)
    clock.now = new Date('2026-09-26T15:01:00Z')
    await check(dispatcher)

    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, error: textNotice('claude: could not stop session-') })
  })
})
