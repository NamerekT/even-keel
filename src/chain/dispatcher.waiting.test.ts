import { describe, expect, it } from 'vitest'
import { notice } from '../notice/notice.js'
import type { Task } from '../tracker/model.js'
import { active, backlog, canceled, done, setup, task, todo, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState, type Dispatcher } from './dispatcher.js'
import { DEFAULT_RULES } from './rules.js'

describe('Dispatcher postponing a task', () => {
  async function running(options: SetupOptions = {}) {
    const context = setup(options)
    context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    context.dispatcher.start('ABC')
    await context.dispatcher.idle()
    return context
  }

  it('moves on when the current task gains an open blocker and its session is not mid-turn', async () => {
    const { dispatcher, launched, journal } = await running()
    dispatcher.setTasks('ABC', [task('ABC-1', todo, 'ABC-3'), task('ABC-2'), task('ABC-3')])
    await dispatcher.idle()

    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(journal[1]).toEqual({
      at: '2026-09-26T12:00:00.000Z',
      project: 'ABC',
      task: 'ABC-1',
      sessionId: 'session-1',
      reason: 'postpone',
      blockers: ['ABC-3'],
    })
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-2', 'ABC-3', 'ABC-1'])
  })

  it('waits while the session of the blocked task is mid-turn', async () => {
    const { dispatcher, launched, busy } = await running({ busy: new Set(['ABC-1']) })
    dispatcher.setTasks('ABC', [task('ABC-1', todo, 'ABC-3'), task('ABC-2'), task('ABC-3')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-1')

    busy.clear()
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('keeps the task when its blocker is not among the tasks of the project', async () => {
    const { dispatcher, launched } = await running()
    dispatcher.setTasks('ABC', [task('ABC-1', todo, 'XYZ-1'), task('ABC-2'), task('ABC-3')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])
  })

  it('moves on when the current task gains a blocker in the backlog', async () => {
    const { dispatcher, launched, journal } = await running()
    dispatcher.setTasks('ABC', [task('ABC-1', todo, 'ABC-9'), task('ABC-2'), task('ABC-3'), task('ABC-9', backlog)])
    await dispatcher.idle()

    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(journal[1]).toMatchObject({ task: 'ABC-1', reason: 'postpone', blockers: ['ABC-9'] })
  })
})

describe('Dispatcher with a blocker in the backlog', () => {
  const tasks = (blocker = backlog, ...rest: Task[]) => [task('ABC-1', blocker), task('ABC-2', todo, 'ABC-1'), task('ABC-3'), ...rest]

  it('does not launch a task held by a blocker in the backlog and shows the blocker', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', tasks())
    dispatcher.start('ABC')
    await dispatcher.idle()

    expect(launched).toEqual(['ABC/ABC-3'])
    expect(dispatcher.orders()['ABC']).toEqual({ order: ['ABC-3', 'ABC-2'], waiting: ['ABC-1'], backlog: [], landing: { 'ABC-1': 'ABC-2' }, error: null })
  })

  it('shows the backlog blockers of a backlog blocker too', async () => {
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1', backlog, 'ABC-4'), task('ABC-2', todo, 'ABC-1'), task('ABC-4', backlog), task('ABC-5', backlog)])
    expect(dispatcher.orders()['ABC']?.waiting).toEqual(['ABC-1', 'ABC-4'])
    expect(dispatcher.orders()['ABC']?.backlog).toEqual(['ABC-5'])
  })

  it('gives the chain, its blockers that may yet enter it and the current task', async () => {
    const { dispatcher } = setup()
    dispatcher.setOutside('ABC', [task('XYZ-9', backlog)])
    dispatcher.setTasks('ABC', [task('ABC-1', backlog), task('ABC-2', todo, 'ABC-1', 'XYZ-9'), task('ABC-3', todo), task('ABC-5', backlog)])
    dispatcher.start('ABC')
    await dispatcher.idle()

    const { tasks, blockers, current } = dispatcher.view('ABC')
    expect(tasks.map((each) => each.id)).toEqual(['ABC-2', 'ABC-3'])
    expect(blockers.map((each) => each.id)).toEqual(['ABC-1'])
    expect(current).toBe('ABC-3')
    expect(dispatcher.view('XYZ')).toEqual({ tasks: [], blockers: [], current: undefined })
  })

  it('previews the chain a task list would give without taking it', async () => {
    const { dispatcher } = setup()
    dispatcher.setOutside('ABC', [task('XYZ-9', backlog)])
    const before = [task('ABC-1', backlog), task('ABC-2', todo, 'ABC-1', 'XYZ-9'), task('ABC-5', backlog)]
    dispatcher.setTasks('ABC', before)

    const { tasks, blockers } = dispatcher.preview('ABC', [task('ABC-1', backlog), task('ABC-2', todo, 'ABC-1', 'XYZ-9'), task('ABC-5', todo)])
    expect(tasks.map((each) => each.id)).toEqual(['ABC-2', 'ABC-5'])
    expect(blockers.map((each) => each.id)).toEqual(['ABC-1'])
    expect(dispatcher.view('ABC').tasks.map((each) => each.id)).toEqual(['ABC-2'])
    expect(dispatcher.orders()['ABC']?.backlog).toEqual(['ABC-5'])
  })

  it('does not start a chain when every task left waits on the backlog', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1', backlog), task('ABC-2', todo, 'ABC-1')])
    await expect(dispatcher.start('ABC')).rejects.toMatchObject({ notice: { code: 'chain.empty', cause: { code: 'chain.emptyBlocked' } } })
    await dispatcher.idle()

    expect(launched).toEqual([])
    expect(dispatcher.state.active).toEqual([])
  })

  it('takes the blocker into the chain once it moves to Todo', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', tasks())
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', todo), task('ABC-2', todo, 'ABC-1'), task('ABC-3', done)])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-3', 'ABC/ABC-1'])
    expect(dispatcher.orders()['ABC']).toEqual({ order: ['ABC-1', 'ABC-2'], waiting: [], backlog: [], error: null })
  })

  it('frees the task once the blocker is closed', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', tasks())
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', tasks(canceled).map((each) => (each.id === 'ABC-3' ? { ...each, status: done } : each)))
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-3', 'ABC/ABC-2'])
    expect(dispatcher.orders()['ABC']?.waiting).toEqual([])
  })

  it('holds a task on an open blocker that the labels keep out of the chain', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [{ ...task('ABC-1', todo), labels: ['Manual'] }, task('ABC-2', todo, 'ABC-1'), task('ABC-3')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    expect(launched).toEqual(['ABC/ABC-3'])
    expect(dispatcher.orders()['ABC']).toEqual({ order: ['ABC-3', 'ABC-2'], waiting: ['ABC-1'], backlog: [], error: null })
  })

  it('holds a task on an open blocker without a required label', async () => {
    const { dispatcher, launched } = setup({ rules: { ABC: { ...DEFAULT_RULES, requiredLabels: ['auto'] } } })
    dispatcher.setTasks('ABC', [task('ABC-1', todo), { ...task('ABC-2', todo, 'ABC-1'), labels: ['auto'] }])
    await expect(dispatcher.start('ABC')).rejects.toMatchObject({ notice: { code: 'chain.empty' } })
    await dispatcher.idle()

    expect(launched).toEqual([])
    expect(dispatcher.orders()['ABC']).toEqual({
      order: ['ABC-2'],
      waiting: ['ABC-1'],
      backlog: [],
      landing: { 'ABC-1': 'ABC-2' },
      requiredLabel: { 'ABC-1': false, 'ABC-2': true },
      error: null,
    })
  })

  it('holds a task on an open blocker from outside the project task list and hands it to the page', async () => {
    const { dispatcher, launched } = setup()
    const foreign = task('XYZ-1', active)
    dispatcher.setOutside('ABC', [foreign, task('XYZ-2', done)])
    dispatcher.setTasks('ABC', [task('ABC-1', todo, 'XYZ-1'), task('ABC-2', todo, 'XYZ-2'), task('ABC-3')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    expect(launched).toEqual(['ABC/ABC-2'])
    expect(dispatcher.orders()['ABC']).toEqual({ order: ['ABC-2', 'ABC-1', 'ABC-3'], waiting: ['XYZ-1'], outside: [foreign], backlog: [], error: null })
  })

  it('frees the task once the outside blocker is closed', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setOutside('ABC', [task('XYZ-1', active)])
    dispatcher.setTasks('ABC', [task('ABC-1', todo, 'XYZ-1')])
    dispatcher.setOutside('ABC', [task('XYZ-1', canceled)])
    dispatcher.setTasks('ABC', [task('ABC-1', todo, 'XYZ-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.orders()['ABC']).toEqual({ order: ['ABC-1'], waiting: [], backlog: [], error: null })
  })

  it('postpones the current task once a manual blocker is added to it', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-2'), task('ABC-3')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [{ ...task('ABC-1', todo), labels: ['Вручную'] }, task('ABC-2', todo, 'ABC-1'), task('ABC-3')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-2', 'ABC/ABC-3'])
  })
})

describe('Dispatcher skipping a task', () => {
  async function running(options: SetupOptions = {}) {
    const context = setup(options)
    context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    context.dispatcher.start('ABC')
    await context.dispatcher.idle()
    return context
  }

  it('lets the current task go and launches the next one', async () => {
    const { dispatcher, launched, journal } = await running()
    dispatcher.skip('ABC', 'ABC-1')
    await dispatcher.idle()

    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.skipped).toEqual({ ABC: ['ABC-1'] })
    expect(journal[1]).toEqual({ at: '2026-09-26T12:00:00.000Z', project: 'ABC', task: 'ABC-1', sessionId: 'session-1', reason: 'skip' })
  })

  it('puts the skipped task below the running one and takes an order with it above', async () => {
    const { dispatcher } = await running()
    dispatcher.skip('ABC', 'ABC-1')
    await dispatcher.idle()

    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-2', 'ABC-1'])
    dispatcher.reorder('ABC', ['ABC-1', 'ABC-2'])
    expect(dispatcher.state.orders.ABC).toEqual(['ABC-1', 'ABC-2'])
  })

  it('never takes a skipped task, even the last open one', async () => {
    const { dispatcher, launched } = await running()
    dispatcher.skip('ABC', 'ABC-1')
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', done)])
    await dispatcher.idle()

    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.active).toEqual([])
  })

  it('refuses to skip the current task while its session is mid-turn', async () => {
    const { dispatcher, launched } = await running({ busy: new Set(['ABC-1']) })
    expect(() => dispatcher.skip('ABC', 'ABC-1')).toThrow('chain: ABC-1 is mid-turn; wait until its session stops')
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.skipped).toEqual({})
  })

  it('refuses to skip a released task while its session is mid-turn, so a restarted chain takes the live session again', async () => {
    const { dispatcher, launched } = await running({ busy: new Set(['ABC-1']), live: { 'ABC-1': 'session-1' } })
    dispatcher.stop('ABC')
    expect(() => dispatcher.skip('ABC', 'ABC-1')).toThrow('chain: ABC-1 is mid-turn; wait until its session stops')
    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]?.current).toMatchObject({ task: 'ABC-1', sessionId: 'session-1' })
    expect(dispatcher.state.skipped).toEqual({})
  })

  it('skips a task ahead and takes it again once returned', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.skip('ABC', 'ABC-2')
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2'), task('ABC-3')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-3'])

    dispatcher.unskip('ABC', 'ABC-2')
    dispatcher.setTasks('ABC', [task('ABC-2'), task('ABC-3', done)])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-3', 'ABC/ABC-2'])
    expect(dispatcher.state.skipped).toEqual({})
  })

  it('forgets a skipped task once it is closed in Huly', async () => {
    const { dispatcher } = await running()
    dispatcher.skip('ABC', 'ABC-2')
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', canceled)])
    await dispatcher.idle()
    expect(dispatcher.state.skipped).toEqual({})
  })

  it('refuses to skip the current task while its session is still launching', () => {
    const state: ChainState = {
      ...emptyChainState(),
      active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: null, since: 't' }, paused: true, error: null }],
    }
    const { dispatcher } = setup({ state })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    expect(() => dispatcher.skip('ABC', 'ABC-1')).toThrow('chain: ABC-1 is still launching; try again in a moment')
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-1')
  })

  it('refuses a task that is not open in the chain', async () => {
    const { dispatcher } = await running()
    expect(() => dispatcher.skip('ABC', 'ABC-9')).toThrow('chain: ABC-9 is not an open task of ABC')
  })
})
