import { describe, expect, it } from 'vitest'
import type { HulyTask, TaskStatus } from '../huly/model.js'
import { Dispatcher, emptyChainState, type ChainState, type LaunchEntry } from './dispatcher.js'
import type { AccountNow, LimitedSession } from './relay.js'

const todo: TaskStatus = { name: 'Todo', category: 'ToDo' }
const active: TaskStatus = { name: 'In Progress', category: 'Active' }
const done: TaskStatus = { name: 'Done', category: 'Won' }
const canceled: TaskStatus = { name: 'Canceled', category: 'Lost' }
const task = (id: string, status: TaskStatus = todo, ...blockedBy: string[]): HulyTask => ({
  id,
  title: id,
  status,
  blockedBy,
  milestone: null,
})

function setup(
  options: {
    state?: ChainState
    failLaunch?: string
    live?: Record<string, string>
    projects?: string[]
    blocked?: string
    limited?: Record<string, LimitedSession>
    account?: AccountNow
    accountAt?: (at: string) => string | null
    failRelay?: boolean
  } = {},
) {
  const clock = { now: new Date('2026-09-26T12:00:00Z') }
  const account: AccountNow = options.account ?? { email: 'john@example.com', ready: true }
  const limited: Record<string, LimitedSession> = options.limited ?? {}
  const relays: { kind: string; task: string; sessionId: string; prompt?: string }[] = []
  const launched: string[] = []
  const saved: ChainState[] = []
  const journal: LaunchEntry[] = []
  let counter = 0
  const dispatcher = new Dispatcher(options.state ?? emptyChainState(), {
    projects: options.projects ?? ['ABC', 'XYZ'],
    launch: async (project, id) => {
      if (id === options.failLaunch) throw new Error(`claude: could not start ${id}`)
      launched.push(`${project}/${id}`)
      return `session-${++counter}`
    },
    liveSession: (id) => options.live?.[id],
    blocked: () => options.blocked,
    save: (state) => saved.push(structuredClone(state)),
    journal: (entry) => journal.push(entry),
    now: () => clock.now,
    limited: (id) => limited[id],
    account: () => account,
    accountAt: options.accountAt ?? (() => account.email),
    limitReset: () => null,
    resume: async (_task, session) => {
      relays.push({ kind: 'resume', task: '', sessionId: session.sessionId })
      return session.sessionId
    },
    relay: async (id, session, prompt) => {
      if (options.failRelay) throw new Error(`claude: could not stop ${session.agentId}`)
      relays.push({ kind: 'relay', task: id, sessionId: session.sessionId, prompt })
      return `session-${++counter}`
    },
  })
  return { dispatcher, launched, saved, journal, clock, account, limited, relays }
}

describe('Dispatcher', () => {
  it('launches the first task in order when the chain starts', async () => {
    const { dispatcher, launched, journal } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1', todo, 'ABC-2'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    expect(launched).toEqual(['ABC/ABC-2'])
    expect(dispatcher.state.active?.current).toEqual({ task: 'ABC-2', sessionId: 'session-1', since: '2026-09-26T12:00:00.000Z' })
    expect(journal).toEqual([{ at: '2026-09-26T12:00:00.000Z', project: 'ABC', task: 'ABC-2', sessionId: 'session-1' }])
  })

  it('waits for the task list before launching', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual([])

    dispatcher.setTasks('ABC', [task('ABC-1')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])
  })

  it('launches the next task when the current one is done', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.active?.current?.task).toBe('ABC-2')
  })

  it('treats a canceled or vanished current task as closed', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', canceled), task('ABC-2'), task('ABC-3')])
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-3')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2', 'ABC/ABC-3'])
  })

  it('does nothing while the current task is open, whatever its status', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', active), task('ABC-2')])
    dispatcher.setTasks('ABC', [task('ABC-1', { name: 'In Review', category: 'Active' }), task('ABC-2')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])
  })

  it('adopts a live session instead of launching a second one', async () => {
    const { dispatcher, launched, journal } = setup({ live: { 'ABC-1': 'manual-session' } })
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    expect(launched).toEqual([])
    expect(journal).toEqual([])
    expect(dispatcher.state.active?.current?.sessionId).toBe('manual-session')
  })

  it('finishes the chain when no open task is left', async () => {
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [])
    await dispatcher.idle()
    expect(dispatcher.state.active).toBeNull()
  })

  it('does not launch the next task while paused, and resumes', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.pause()
    dispatcher.setTasks('ABC', [task('ABC-2')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])

    dispatcher.resume()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('pauses with the error when a launch fails, and retries on resume', async () => {
    const options = { failLaunch: 'ABC-1' as string | undefined }
    const { dispatcher, launched } = setup(options)
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(dispatcher.state.active).toMatchObject({ paused: true, error: 'claude: could not start ABC-1', current: null })

    options.failLaunch = undefined
    dispatcher.resume()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active).toMatchObject({ paused: false, error: null })
  })

  it('refuses to start or resume a chain while launches are blocked', async () => {
    const options: { blocked?: string } = { blocked: 'claude: not signed in' }
    const { dispatcher, launched, saved } = setup(options)
    dispatcher.setTasks('ABC', [task('ABC-1')])
    expect(() => dispatcher.start('ABC')).toThrow('claude: not signed in')
    expect(saved).toEqual([])

    options.blocked = undefined
    dispatcher.start('ABC')
    dispatcher.pause()
    options.blocked = 'claude: sign-in is in progress'
    expect(() => dispatcher.resume()).toThrow('claude: sign-in is in progress')
    expect(dispatcher.state.active).toMatchObject({ paused: true })
    await dispatcher.idle()
    expect(launched).toEqual([])
  })

  it('still queues a project behind a running chain while launches are blocked', () => {
    const options: { blocked?: string } = {}
    const { dispatcher } = setup(options)
    dispatcher.start('ABC')
    options.blocked = 'claude: not signed in'
    dispatcher.start('XYZ')
    expect(dispatcher.state.queue).toEqual(['XYZ'])
  })

  it('pauses with the reason instead of launching the next task while launches are blocked', async () => {
    const options: { blocked?: string } = {}
    const { dispatcher, launched } = setup(options)
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    options.blocked = 'claude: not signed in'
    dispatcher.setTasks('ABC', [task('ABC-2')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active).toMatchObject({ paused: true, error: 'claude: not signed in', current: null })

    options.blocked = undefined
    dispatcher.resume()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('pauses with the cycle when the order cannot be built', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1', todo, 'ABC-2'), task('ABC-2', todo, 'ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(dispatcher.state.active?.error).toMatch(/cycle: ABC-1 → ABC-2 → ABC-1/)
  })

  it('queues a second project and starts it when the first chain ends', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.setTasks('XYZ', [task('XYZ-1')])
    dispatcher.start('ABC')
    dispatcher.start('XYZ')
    dispatcher.start('XYZ')
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.queue).toEqual(['XYZ'])

    dispatcher.setTasks('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'XYZ/XYZ-1'])
    expect(dispatcher.state.queue).toEqual([])
    expect(dispatcher.state.active?.project).toBe('XYZ')
  })

  it('stops the chain without waiting for its task and moves on to the queue', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.setTasks('XYZ', [task('XYZ-1')])
    dispatcher.start('ABC')
    dispatcher.start('XYZ')
    await dispatcher.idle()

    dispatcher.stop()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'XYZ/XYZ-1'])
  })

  it('removes a project from the queue', async () => {
    const { dispatcher } = setup()
    dispatcher.start('ABC')
    dispatcher.start('XYZ')
    dispatcher.dequeue('XYZ')
    expect(dispatcher.state.queue).toEqual([])
  })

  it('reorders the queue and starts the project moved to its head first', async () => {
    const { dispatcher, launched } = setup({ projects: ['ABC', 'XYZ', 'OPS'] })
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.setTasks('XYZ', [task('XYZ-1')])
    dispatcher.setTasks('OPS', [task('OPS-1')])
    dispatcher.start('ABC')
    dispatcher.start('XYZ')
    dispatcher.start('OPS')
    await dispatcher.idle()
    dispatcher.requeue(['OPS', 'XYZ'])
    expect(dispatcher.state.queue).toEqual(['OPS', 'XYZ'])

    dispatcher.setTasks('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'OPS/OPS-1'])
    expect(dispatcher.state.queue).toEqual(['XYZ'])
  })

  it('refuses a queue order that does not list exactly the queued projects', () => {
    const { dispatcher, saved } = setup({ projects: ['ABC', 'XYZ', 'OPS'] })
    dispatcher.start('ABC')
    dispatcher.start('XYZ')
    dispatcher.start('OPS')
    const before = saved.length
    const refusal = /queue has changed/
    expect(() => dispatcher.requeue(['XYZ'])).toThrow(refusal)
    expect(() => dispatcher.requeue(['XYZ', 'OPS', 'ABC'])).toThrow(refusal)
    expect(() => dispatcher.requeue(['XYZ', 'XYZ'])).toThrow(refusal)
    expect(dispatcher.state.queue).toEqual(['XYZ', 'OPS'])
    expect(saved.length).toBe(before)
  })

  it('rejects an unknown project', () => {
    const { dispatcher } = setup()
    expect(() => dispatcher.start('QQQ')).toThrow('QQQ is not a configured project')
  })

  it('keeps a manual order and refuses one that breaks a blocker', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3', todo, 'ABC-2')])
    expect(() => dispatcher.reorder('ABC', ['ABC-3', 'ABC-2', 'ABC-1'])).toThrow(/ABC-3 cannot go before ABC-2/)

    dispatcher.reorder('ABC', ['ABC-2', 'ABC-3', 'ABC-1'])
    expect(dispatcher.orders().ABC).toEqual({ order: ['ABC-2', 'ABC-3', 'ABC-1'], error: null })
    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-2'])
  })

  it('saves every change and picks up where it left off after a restart', async () => {
    const first = setup()
    first.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    first.dispatcher.start('ABC')
    first.dispatcher.start('XYZ')
    await first.dispatcher.idle()
    first.dispatcher.pause()
    await first.dispatcher.idle()
    const persisted = first.saved.at(-1)
    expect(persisted).toEqual(first.dispatcher.state)

    const second = setup({ state: persisted })
    second.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    second.dispatcher.resume()
    await second.dispatcher.idle()
    expect(first.launched).toEqual(['ABC/ABC-1'])
    expect(second.launched).toEqual([])

    second.dispatcher.setTasks('ABC', [task('ABC-2')])
    await second.dispatcher.idle()
    expect(second.launched).toEqual(['ABC/ABC-2'])
    expect(second.dispatcher.state.queue).toEqual(['XYZ'])
  })

  it('pauses a launch that a restart interrupted', async () => {
    const state: ChainState = {
      ...emptyChainState(),
      active: { project: 'ABC', current: { task: 'ABC-1', sessionId: null, since: 'x' }, paused: false, error: null },
    }
    const { dispatcher, launched } = setup({ state })
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(dispatcher.state.active).toMatchObject({ paused: true, current: null })
    expect(dispatcher.state.active?.error).toMatch(/ABC-1.*restart/)
  })

  it('puts a new task at the head of a manual order and keeps it there', () => {
    const { dispatcher, saved } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.reorder('ABC', ['ABC-2', 'ABC-1'])
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-4'), task('ABC-3')])
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-3', 'ABC-4', 'ABC-2', 'ABC-1'])
    expect(saved.at(-1)?.orders.ABC).toEqual(['ABC-3', 'ABC-4', 'ABC-2', 'ABC-1'])
  })

  it('puts a new task right after the running one', async () => {
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.reorder('ABC', ['ABC-2', 'ABC-1'])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', active), task('ABC-3')])
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-2', 'ABC-3', 'ABC-1'])
  })

  it('puts a new blocked task right after its last blocker', () => {
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    dispatcher.reorder('ABC', ['ABC-3', 'ABC-1', 'ABC-2'])
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3'), task('ABC-4', todo, 'ABC-3', 'ABC-1')])
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-3', 'ABC-1', 'ABC-4', 'ABC-2'])
  })

  it('treats a reopened task as new', () => {
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    dispatcher.reorder('ABC', ['ABC-1', 'ABC-2', 'ABC-3'])
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3', done)])
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-3', 'ABC-1', 'ABC-2'])
  })

  it('keeps ordering by number until the order is changed by hand', () => {
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', [task('ABC-2'), task('ABC-3')])
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-1', 'ABC-2', 'ABC-3'])
    expect(dispatcher.state.orders.ABC).toBeUndefined()
  })

  it('keeps the running task first and refuses to move anything above it', async () => {
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.state.orders.ABC = ['ABC-3', 'ABC-1', 'ABC-2']
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-1', 'ABC-3', 'ABC-2'])
    expect(() => dispatcher.reorder('ABC', ['ABC-2', 'ABC-1', 'ABC-3'])).toThrow('ABC-1 is running and stays first')
    dispatcher.reorder('ABC', ['ABC-1', 'ABC-2', 'ABC-3'])
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-1', 'ABC-2', 'ABC-3'])
  })
})

describe('Dispatcher on a limit', () => {
  const limitedSession = (sessionId: string, at: string, lastReplyAt: string): LimitedSession => ({
    sessionId,
    agentId: sessionId.slice(0, 8),
    cwd: 'D:/work/abc',
    workdir: 'D:/work/abc/.claude/worktrees/abc-1',
    branch: 'abc-1/work',
    transcript: null,
    limit: { at, text: "You've hit your session limit · resets 3pm (UTC)" },
    lastReplyAt,
    recent: [],
  })

  async function running(options: Parameters<typeof setup>[0] = {}) {
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
    expect(dispatcher.state.active?.current?.limit).toEqual({
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

  it('hands the task to a new session in the old worktree once the limit resets with a cold cache', async () => {
    const { dispatcher, limited, clock, relays, journal } = await running()
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    await check(dispatcher)

    clock.now = new Date('2026-09-26T15:00:00Z')
    await check(dispatcher)

    expect(relays).toMatchObject([{ kind: 'relay', task: 'ABC-1', sessionId: 'session-1' }])
    expect(relays[0]?.prompt).toContain('D:/work/abc/.claude/worktrees/abc-1')
    expect(dispatcher.state.active?.current).toMatchObject({ task: 'ABC-1', sessionId: 'session-2', since: '2026-09-26T12:00:00.000Z' })
    expect(journal.at(-1)).toEqual({
      at: '2026-09-26T15:00:00.000Z',
      project: 'ABC',
      task: 'ABC-1',
      sessionId: 'session-2',
      reason: 'relay',
      previous: 'session-1',
    })

    await check(dispatcher)
    expect(relays).toHaveLength(1)
  })

  it('resumes the same session when the limit resets while its cache is warm', async () => {
    const { dispatcher, limited, clock, relays, journal } = await running()
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T14:30:00.000Z', '2026-09-26T14:29:00.000Z')
    await check(dispatcher)
    expect(dispatcher.state.active?.current?.limit?.then).toBe('resume')

    clock.now = new Date('2026-09-26T15:00:10Z')
    await check(dispatcher)

    expect(relays).toMatchObject([{ kind: 'resume', sessionId: 'session-1' }])
    expect(dispatcher.state.active?.current?.sessionId).toBe('session-1')
    expect(journal.at(-1)).toMatchObject({ sessionId: 'session-1', reason: 'resume', previous: 'session-1' })

    await check(dispatcher)
    expect(relays).toHaveLength(1)
  })

  it('hands over before the reset when the account was switched', async () => {
    const { dispatcher, limited, clock, relays, account } = await running()
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    await check(dispatcher)

    account.email = 'jane@example.com'
    clock.now = new Date('2026-09-26T12:05:00Z')
    await check(dispatcher)
    expect(relays).toMatchObject([{ kind: 'relay' }])
  })

  it('hands over when the account was switched on a paused chain before the limit was noted', async () => {
    const accountAt = (at: string) => (at < '2026-09-26T12:03:00.000Z' ? 'john@example.com' : 'jane@example.com')
    const { dispatcher, limited, clock, relays, account } = await running({ accountAt })
    dispatcher.pause()
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    account.email = 'jane@example.com'
    clock.now = new Date('2026-09-26T12:05:00Z')
    dispatcher.resume()
    await dispatcher.idle()

    expect(dispatcher.state.active?.current?.limit?.account).toBe('john@example.com')
    expect(relays).toMatchObject([{ kind: 'relay' }])
  })

  it('waits to note a limit until the account is known', async () => {
    const { dispatcher, limited, account } = await running({ accountAt: () => null })
    account.email = null
    account.ready = false
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    await check(dispatcher)
    expect(dispatcher.state.active?.current?.limit).toBeUndefined()
  })

  it('acts again on a new limit of the relayed session', async () => {
    const { dispatcher, limited, clock, relays } = await running()
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    await check(dispatcher)
    clock.now = new Date('2026-09-26T15:00:00Z')
    await check(dispatcher)

    limited['ABC-1'] = limitedSession('session-2', '2026-09-26T16:00:00.000Z', '2026-09-26T15:59:00.000Z')
    clock.now = new Date('2026-09-26T16:00:00Z')
    await check(dispatcher)
    expect(dispatcher.state.active?.current?.limit).toMatchObject({ at: '2026-09-26T16:00:00.000Z', acted: null })

    clock.now = new Date('2026-09-27T15:00:00Z')
    await check(dispatcher)
    expect(relays.map((relay) => relay.sessionId)).toEqual(['session-1', 'session-2'])
  })

  it('forgets the limit once the session answers again', async () => {
    const { dispatcher, limited } = await running()
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    await check(dispatcher)

    delete limited['ABC-1']
    await check(dispatcher)
    expect(dispatcher.state.active?.current?.limit).toBeUndefined()
  })

  it('leaves a paused chain alone', async () => {
    const { dispatcher, limited, clock, relays } = await running()
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    dispatcher.pause()
    clock.now = new Date('2026-09-26T16:00:00Z')
    await check(dispatcher)
    expect(relays).toEqual([])
  })

  it('pauses the chain when the handover fails', async () => {
    const { dispatcher, limited, clock } = await running({ failRelay: true })
    limited['ABC-1'] = limitedSession('session-1', '2026-09-26T12:00:00.000Z', '2026-09-26T11:59:00.000Z')
    await check(dispatcher)
    clock.now = new Date('2026-09-26T15:00:00Z')
    await check(dispatcher)

    expect(dispatcher.state.active).toMatchObject({ paused: true, error: 'claude: could not stop session-' })
  })
})
