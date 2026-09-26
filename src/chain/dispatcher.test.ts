import { describe, expect, it } from 'vitest'
import type { HulyTask, TaskStatus } from '../huly/model.js'
import { Dispatcher, emptyChainState, type ChainState, type LaunchEntry } from './dispatcher.js'

const todo: TaskStatus = { name: 'Todo', category: 'ToDo' }
const active: TaskStatus = { name: 'In Progress', category: 'Active' }
const done: TaskStatus = { name: 'Done', category: 'Won' }
const canceled: TaskStatus = { name: 'Canceled', category: 'Lost' }
const task = (id: string, status: TaskStatus = todo, ...blockedBy: string[]): HulyTask => ({
  id,
  title: id,
  status,
  blockedBy,
})

function setup(
  options: {
    state?: ChainState
    failLaunch?: string
    live?: Record<string, string>
    projects?: string[]
    blocked?: string
  } = {},
) {
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
    now: () => new Date('2026-09-26T12:00:00Z'),
  })
  return { dispatcher, launched, saved, journal }
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
