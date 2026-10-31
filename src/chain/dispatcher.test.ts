import { describe, expect, it } from 'vitest'
import { englishOf, notice, textNotice } from '../notice/notice.js'
import type { Task } from '../tracker/model.js'
import { active, backlog, canceled, done, pause, review, setup, task, todo, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState, type Dispatcher } from './dispatcher.js'
import { DEFAULT_RULES } from './rules.js'

describe('Dispatcher', () => {
  it('launches the first task in order when the chain starts', async () => {
    const { dispatcher, launched, journal } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1', todo, 'ABC-2'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    expect(launched).toEqual(['ABC/ABC-2'])
    expect(dispatcher.state.active[0]?.current).toEqual({ task: 'ABC-2', sessionId: 'session-1', since: '2026-09-26T12:00:00.000Z' })
    expect(journal).toEqual([{ at: '2026-09-26T12:00:00.000Z', project: 'ABC', task: 'ABC-2', sessionId: 'session-1' }])
  })

  it('notes in the launch log the provider of a run label the launch could not honour', async () => {
    const { dispatcher, journal } = setup({ fallback: { 'ABC-1': 'codex' } })
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    expect(journal).toEqual([{ at: '2026-09-26T12:00:00.000Z', project: 'ABC', task: 'ABC-1', sessionId: 'session-1', fallback: 'codex' }])
  })

  it('leaves a task labelled for a manual run out of the chain', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [{ ...task('ABC-1'), labels: ['Вручную'] }, task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    expect(launched).toEqual(['ABC/ABC-2'])
    expect(dispatcher.orders()['ABC']?.order).toEqual(['ABC-2'])
  })

  it('takes only the tasks carrying a label the project requires', async () => {
    const { dispatcher, launched } = setup({ rules: { ABC: { ...DEFAULT_RULES, requiredLabels: ['Auto'] } } })
    dispatcher.setTasks('ABC', [task('ABC-1'), { ...task('ABC-2'), labels: ['auto'] }])
    dispatcher.start('ABC')
    await dispatcher.idle()

    expect(dispatcher.orders()['ABC']?.order).toEqual(['ABC-2'])
    expect(launched).toEqual(['ABC/ABC-2'])
  })

  it('takes only the statuses the project names active and lets the rest hold their dependents', async () => {
    const { dispatcher, launched } = setup({ rules: { ABC: { ...DEFAULT_RULES, active: ['Todo', 'In Progress'] } } })
    dispatcher.setTasks('ABC', [task('ABC-1', review), task('ABC-2', todo, 'ABC-1'), task('ABC-3', active)])
    dispatcher.start('ABC')
    await dispatcher.idle()

    expect(dispatcher.orders()['ABC']).toEqual({ order: ['ABC-3', 'ABC-2'], waiting: ['ABC-1'], backlog: [], landing: { 'ABC-1': 'ABC-2' }, error: null })
    expect(launched).toEqual(['ABC/ABC-3'])
  })

  it('moves on without clean-up when the current task reaches a terminal status outside Won', async () => {
    const { dispatcher, launched, finished } = setup({ rules: { ABC: { ...DEFAULT_RULES, terminal: ['In Review', 'Done'] } } })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', review), task('ABC-2')])
    await dispatcher.idle()
    expect(finished).toEqual([])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it("judges a feed's tasks by its own rules in one chain with the project's (BTN-66)", async () => {
    const { dispatcher, launched } = setup({ rules: { ABCGH: { ...DEFAULT_RULES, active: ['open'], terminal: ['closed'] } } })
    const open = { name: 'open', category: 'UnStarted' } as const
    const closed = { name: 'closed', category: 'UnStarted' } as const
    dispatcher.setTasks('ABC', [task('ABC-1', backlog), task('ABC-2', todo, 'ABCGH-4'), task('ABCGH-3', open), task('ABCGH-4', closed)])
    dispatcher.start('ABC')
    await dispatcher.idle()

    expect(dispatcher.orders()['ABC']?.order).toEqual(['ABC-2', 'ABCGH-3'])
    expect(dispatcher.orders()['ABC']?.waiting).toEqual([])
    expect(launched).toEqual(['ABC/ABC-2'])
  })

  it('applies changed rules with the next task list', async () => {
    const rules = { ABC: DEFAULT_RULES }
    const { dispatcher } = setup({ rules })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    expect(dispatcher.orders()['ABC']?.order).toEqual(['ABC-1', 'ABC-2'])

    rules.ABC = { ...DEFAULT_RULES, excludedLabels: ['Bug'] }
    dispatcher.setTasks('ABC', [{ ...task('ABC-1'), labels: ['Bug'] }, task('ABC-2')])
    expect(dispatcher.orders()['ABC']?.order).toEqual(['ABC-2'])
  })

  it('leaves backlog tasks out of the chain', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1', backlog), task('ABC-2', todo), task('ABC-3', review)])
    dispatcher.start('ABC')
    await dispatcher.idle()

    expect(dispatcher.orders()['ABC']).toEqual({
      order: ['ABC-2', 'ABC-3'],
      waiting: [],
      backlog: ['ABC-1'],
      landing: { 'ABC-1': 'ABC-3' },
      error: null,
    })
    expect(launched).toEqual(['ABC/ABC-2'])
  })

  it('tells before which task a backlog task would stand once the chain takes it', () => {
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', [
      task('ABC-1'),
      task('ABC-2'),
      task('ABC-3', backlog),
      { ...task('ABC-4', backlog), priority: 'urgent' },
      task('ABC-5', backlog, 'ABC-1'),
    ])
    expect(dispatcher.orders()['ABC']?.landing).toEqual({ 'ABC-3': null, 'ABC-4': 'ABC-1', 'ABC-5': null })
    expect(dispatcher.orders()['ABC']?.order).toEqual(['ABC-1', 'ABC-2'])
  })

  it('places a backlog task in a manual order the way a new task is placed', async () => {
    const { dispatcher, saved } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3', backlog)])
    dispatcher.reorder('ABC', ['ABC-2', 'ABC-1'])
    const writes = saved.length
    expect(dispatcher.orders()['ABC']?.landing).toEqual({ 'ABC-3': 'ABC-2' })
    expect(saved).toHaveLength(writes)

    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(dispatcher.orders()['ABC']?.landing).toEqual({ 'ABC-3': 'ABC-1' })

    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', active), task('ABC-3')])
    expect(dispatcher.orders()['ABC']?.order).toEqual(['ABC-2', 'ABC-3', 'ABC-1'])
  })

  it('tells no place for a backlog task the chain would still not take', () => {
    const { dispatcher } = setup({ rules: { ABC: { ...DEFAULT_RULES, requiredLabels: ['ready'], excludedLabels: ['Manual'] } } })
    dispatcher.setTasks('ABC', [{ ...task('ABC-1'), labels: ['ready'] }, { ...task('ABC-2', backlog), labels: ['ready', 'Manual'] }, { ...task('ABC-3', backlog), labels: ['ready'] }])
    expect(dispatcher.orders()['ABC']?.landing).toEqual({ 'ABC-3': null })
  })

  it('places a task without the required label as "Into the chain" would let it in, with the label on', () => {
    const { dispatcher } = setup({ rules: { ABC: { ...DEFAULT_RULES, requiredLabels: ['ready'] } } })
    dispatcher.setTasks('ABC', [{ ...task('ABC-1'), labels: ['ready'] }, { ...task('ABC-2'), priority: 'urgent' }, task('ABC-3', backlog)])
    expect(dispatcher.orders()['ABC']).toMatchObject({
      order: ['ABC-1'],
      backlog: ['ABC-2', 'ABC-3'],
      landing: { 'ABC-2': 'ABC-1', 'ABC-3': null },
      requiredLabel: { 'ABC-1': true, 'ABC-2': false, 'ABC-3': false },
    })
  })

  it('tells the place of a waiting blocker the chain would take, but not of one it would not', () => {
    const { dispatcher } = setup({ rules: { ABC: { ...DEFAULT_RULES, excludedLabels: ['Manual'] } } })
    dispatcher.setOutside('ABC', [task('XYZ-1', backlog)])
    dispatcher.setTasks('ABC', [
      task('ABC-1'),
      task('ABC-2', todo, 'ABC-3', 'ABC-4', 'XYZ-1'),
      task('ABC-3', backlog),
      { ...task('ABC-4', backlog), labels: ['Manual'] },
    ])
    expect(dispatcher.orders()['ABC']).toMatchObject({ waiting: ['ABC-3', 'ABC-4', 'XYZ-1'], landing: { 'ABC-3': 'ABC-2' } })
    expect(dispatcher.orders()['ABC']?.refused).toBeUndefined()
  })

  it('names why a task would stop the chain once taken: a blocker from a later milestone', () => {
    const v1 = { label: 'v0.1', targetDate: null }
    const v2 = { label: 'v0.2', targetDate: null }
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', [{ ...task('ABC-1', todo, 'ABC-2'), milestone: v1 }, { ...task('ABC-2', backlog), milestone: v2 }, task('ABC-3', backlog)])
    expect(dispatcher.orders()['ABC']).toMatchObject({
      order: ['ABC-1'],
      landing: { 'ABC-3': null },
      refused: { 'ABC-2': notice('order.later', { task: 'ABC-1', milestone: 'v0.1', blocker: 'ABC-2', blockerMilestone: 'v0.2' }) },
      error: null,
    })
  })

  it('lists the backlog by number without the tasks the labels keep out or the chain waits on', () => {
    const { dispatcher } = setup({ rules: { ABC: { ...DEFAULT_RULES, excludedLabels: ['Manual'] } } })
    dispatcher.setTasks('ABC', [
      task('ABC-12', backlog),
      task('ABC-3', backlog),
      { ...task('ABC-4', backlog), labels: ['Manual'] },
      task('ABC-5', backlog),
      task('ABC-6', todo, 'ABC-5'),
      task('ABC-7', done),
    ])
    expect(dispatcher.orders()['ABC']?.backlog).toEqual(['ABC-3', 'ABC-12'])
  })

  it('lists in the backlog the tasks still without a required label', () => {
    const { dispatcher } = setup({ rules: { ABC: { ...DEFAULT_RULES, requiredLabels: ['ready'] } } })
    dispatcher.setTasks('ABC', [task('ABC-1'), { ...task('ABC-2'), labels: ['ready'] }])
    expect(dispatcher.orders()['ABC']).toEqual({
      order: ['ABC-2'],
      waiting: [],
      backlog: ['ABC-1'],
      landing: { 'ABC-1': 'ABC-2' },
      requiredLabel: { 'ABC-1': false, 'ABC-2': true },
      error: null,
    })
  })

  it('stops waiting for a current task returned to backlog once its session is not mid-turn', async () => {
    const busy = new Set(['ABC-1'])
    const { dispatcher, launched } = setup({ busy })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', backlog), task('ABC-2')])
    await dispatcher.idle()
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-1')

    busy.clear()
    dispatcher.setTasks('ABC', [task('ABC-1', backlog), task('ABC-2')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('reads the tracker before starting a chain whose task list is not read yet', async () => {
    const { dispatcher, launched, tracker, refreshed } = setup()
    tracker.ABC = [task('ABC-1')]
    await dispatcher.start('ABC')
    await dispatcher.idle()
    expect(refreshed).toEqual(['ABC'])
    expect(launched).toEqual(['ABC/ABC-1'])
  })

  it('reads the tracker anew when a chain starts with nothing to run, so a task created a moment ago is taken', async () => {
    const { dispatcher, launched, tracker, refreshed, log } = setup()
    dispatcher.setTasks('ABC', [])
    tracker.ABC = [task('ABC-1')]
    await dispatcher.start('ABC')
    await dispatcher.idle()
    expect(refreshed).toEqual(['ABC'])
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(log).toEqual([])
  })

  it('does not read the tracker when the task list already has a task to run', async () => {
    const { dispatcher, refreshed } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await dispatcher.start('ABC')
    expect(refreshed).toEqual([])
  })

  it('refuses to start, saying why, when the tracker still has nothing to run', async () => {
    const { dispatcher, tracker, saved, log } = setup()
    tracker.ABC = [task('ABC-1', backlog)]
    await expect(dispatcher.start('ABC')).rejects.toMatchObject({
      notice: notice('chain.empty', { project: 'ABC' }, { cause: notice('chain.emptyStatus', {}) }),
    })
    expect(dispatcher.state.active).toEqual([])
    expect(saved).toEqual([])
    expect(log).toEqual(['chain: ABC has no task to run, not started: none of its open tasks is in a status the chain takes'])
  })

  it('refuses to start while the tracker has not answered with the task list', async () => {
    const { dispatcher } = setup()
    await expect(dispatcher.start('ABC')).rejects.toMatchObject({ notice: notice('chain.notRead', { project: 'ABC' }) })
    expect(dispatcher.state.active).toEqual([])
  })

  it.each([
    ['no open task', [] as Task[], {}, notice('chain.emptyNone', {})],
    ['ready tasks without the required label', [task('ABC-1')], { requiredLabels: ['Auto'] }, notice('chain.emptyLabels', { labels: ['Auto'] })],
    ['only skipped tasks', [task('ABC-1')], {}, notice('chain.emptySkipped', {})],
    ['a ready task held by a blocker outside the chain', [task('ABC-1', todo, 'ABC-2'), task('ABC-2', review)], { active: ['Todo'] }, notice('chain.emptyBlocked', {})],
  ])('names the reason of an empty chain: %s', async (_name, tasks, rules, why) => {
    const { dispatcher, tracker } = setup({ rules: { ABC: { ...DEFAULT_RULES, ...rules } } })
    if (why.code === 'chain.emptySkipped') dispatcher.state.skipped.ABC = ['ABC-1']
    tracker.ABC = tasks
    await expect(dispatcher.start('ABC')).rejects.toMatchObject({ notice: notice('chain.empty', { project: 'ABC' }, { cause: why }) })
  })

  it('logs a chain that ends with no task left', async () => {
    const { dispatcher, log } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(dispatcher.state.active).toEqual([])
    expect(log).toContain('chain: ABC ended, no task left to run')
  })

  it('launches the next task when the current one is done', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-2')
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
    expect(dispatcher.state.active[0]?.current?.sessionId).toBe('manual-session')
  })

  it('finishes the chain when no open task is left', async () => {
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [])
    await dispatcher.idle()
    expect(dispatcher.state.active).toEqual([])
  })

  it('does not launch the next task while paused, and resumes', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    pause(dispatcher, 'ABC')
    dispatcher.setTasks('ABC', [task('ABC-2')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])

    dispatcher.resume('ABC')
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('pauses with the error when a launch fails, and retries on resume', async () => {
    const options = { failLaunch: 'ABC-1' as string | undefined }
    const { dispatcher, launched } = setup(options)
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, error: textNotice('claude: could not start ABC-1'), current: null })

    options.failLaunch = undefined
    dispatcher.resume('ABC')
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active[0]).toMatchObject({ paused: false, error: null })
  })

  it('refuses to start or resume a chain while launches are blocked', async () => {
    const options: { blocked?: string } = { blocked: 'claude: not signed in' }
    const { dispatcher, launched, saved } = setup(options)
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await expect(dispatcher.start('ABC')).rejects.toThrow('claude: not signed in')
    expect(saved).toEqual([])

    options.blocked = undefined
    dispatcher.start('ABC')
    pause(dispatcher, 'ABC')
    options.blocked = 'claude: sign-in is in progress'
    expect(() => dispatcher.resume('ABC')).toThrow('claude: sign-in is in progress')
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true })
    await dispatcher.idle()
    expect(launched).toEqual([])
  })

  it('checks launches on Start and Resume for the task that goes first, whose label may pick another account (BTN-521)', async () => {
    const expired = notice('account.loginExpired', { account: 'john.doe@example.com' })
    const options: SetupOptions = { blocked: (_project, id) => (id === 'ABC-1' ? undefined : expired) }
    const { dispatcher, launched } = setup(options)
    dispatcher.setTasks('ABC', [task('ABC-2', todo, 'ABC-1'), task('ABC-1')])
    await dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])

    pause(dispatcher, 'ABC')
    dispatcher.resume('ABC')
    expect(dispatcher.state.active[0]).toMatchObject({ paused: false, error: null })
  })

  it('refuses Start by the account when the task that goes first runs on it', async () => {
    const expired = notice('account.loginExpired', { account: 'john.doe@example.com' })
    const { dispatcher, launched } = setup({ blocked: (_project, id) => (id === 'ABC-1' ? undefined : expired) })
    dispatcher.setTasks('ABC', [task('ABC-2'), task('ABC-1', todo, 'ABC-2')])
    await expect(dispatcher.start('ABC')).rejects.toThrow(/login of john\.doe@example\.com has run out/)
    expect(launched).toEqual([])
  })

  it('still queues a project behind a running chain while launches are blocked', () => {
    const options: { blocked?: string } = {}
    const { dispatcher } = setup(options)
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.setTasks('XYZ', [task('XYZ-1')])
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
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, error: textNotice('claude: not signed in'), current: null })

    options.blocked = undefined
    dispatcher.resume('ABC')
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('goes on by itself once PR mode has a target again, but not after any other pause', async () => {
    const notReady = notice('review.notReady', { project: 'ABC' }, { cause: notice('review.noRemote', { project: 'ABC' }) })
    const options: SetupOptions = { blocked: notReady }
    const { dispatcher, launched } = setup(options)
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, error: notReady })

    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true })

    options.blocked = undefined
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.active[0]).toMatchObject({ paused: false, error: null })
    expect(launched).toEqual(['ABC/ABC-1'])

    pause(dispatcher, 'ABC')
    dispatcher.state.active[0]!.error = textNotice('claude: not signed in')
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true })
  })

  it('waits for an explicitly requested CLI copy and goes on when it is ready', async () => {
    const options: SetupOptions = { blocked: notice('agent.copyMissing', { title: 'Codex' }) }
    const { dispatcher, launched } = setup(options)
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual([])
    options.blocked = undefined
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])
  })

  it('resumes into the PR mode pause rather than refusing, and goes on once PR mode has a target', async () => {
    const notReady = notice('review.notReady', { project: 'ABC' }, { cause: notice('review.noRemote', { project: 'ABC' }) })
    const options: SetupOptions = {}
    const { dispatcher, launched } = setup(options)
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await dispatcher.start('ABC')
    pause(dispatcher, 'ABC')
    options.blocked = notReady
    dispatcher.resume('ABC')
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, error: notReady })

    options.blocked = undefined
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])
  })

  it('holds the next launch while the limit is used up and launches it after the reset', async () => {
    const options: { limitReset?: string | null } = { limitReset: '2026-09-26T17:00:00.000Z' }
    const { dispatcher, launched, saved } = setup(options)
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]).toEqual({ project: 'ABC', current: null, paused: false, error: null, limitUntil: '2026-09-26T17:00:00.000Z' })
    expect(saved.at(-1)?.active[0]?.limitUntil).toBe('2026-09-26T17:00:00.000Z')

    const savedWhileHeld = saved.length
    dispatcher.check()
    await dispatcher.idle()
    expect(saved).toHaveLength(savedWhileHeld)

    options.limitReset = null
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active[0]?.limitUntil).toBeUndefined()
  })

  it('holds the launch until the account answers its first limits poll since the start', async () => {
    const options: { limitsUnread?: boolean; limitReset?: string | null } = { limitsUnread: true }
    const { dispatcher, launched } = setup(options)
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]).toEqual({ project: 'ABC', current: null, paused: false, error: null })

    options.limitsUnread = false
    options.limitReset = '2026-09-26T17:00:00.000Z'
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]?.limitUntil).toBe('2026-09-26T17:00:00.000Z')
  })

  it('holds the launch while the project set of packages has a problem and launches it once the problem is gone', async () => {
    const options: { packagesBlocked?: Set<string> } = { packagesBlocked: new Set(['ABC']) }
    const { dispatcher, launched, saved } = setup(options)
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]).toEqual({ project: 'ABC', current: null, paused: false, error: null })

    const savedWhileHeld = saved.length
    dispatcher.check()
    await dispatcher.idle()
    expect(saved).toHaveLength(savedWhileHeld)

    options.packagesBlocked = new Set()
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])
  })

  it('waits for the first read of the account folders after a start instead of pausing on an account not read yet', async () => {
    const state: ChainState = { ...emptyChainState(), active: [{ project: 'ABC', current: null, paused: false, error: null }] }
    const options: SetupOptions = { state, accountsRead: false, blocked: 'claude: the active account folder john is gone' }
    const { dispatcher, launched } = setup(options)
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]).toEqual({ project: 'ABC', current: null, paused: false, error: null })

    options.accountsRead = true
    delete options.blocked
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])
  })

  it('takes over a live session of the next task even while the limit is used up', async () => {
    const { dispatcher, launched } = setup({ limitReset: '2026-09-26T17:00:00.000Z', live: { 'ABC-1': 'session-9' } })
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]).toMatchObject({ current: { task: 'ABC-1', sessionId: 'session-9' } })
    expect(dispatcher.state.active[0]?.limitUntil).toBeUndefined()
  })

  it('pauses with the cycle when the order cannot be built', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1', todo, 'ABC-2'), task('ABC-2', todo, 'ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(englishOf(dispatcher.state.active[0]!.error!)).toMatch(/cycle: ABC-1 → ABC-2 → ABC-1/)
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
    expect(dispatcher.state.active[0]?.project).toBe('XYZ')
  })

  it('stops the chain without waiting for its task and moves on to the queue', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.setTasks('XYZ', [task('XYZ-1')])
    dispatcher.start('ABC')
    dispatcher.start('XYZ')
    await dispatcher.idle()

    dispatcher.stop('ABC')
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'XYZ/XYZ-1'])
  })

  it('removes a project from the queue', async () => {
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.setTasks('XYZ', [task('XYZ-1')])
    dispatcher.start('ABC')
    dispatcher.start('XYZ')
    expect(dispatcher.state.queue).toEqual(['XYZ'])
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
    for (const project of ['ABC', 'XYZ', 'OPS']) {
      dispatcher.setTasks(project, [task(`${project}-1`)])
      dispatcher.start(project)
    }
    const before = saved.length
    const refusal = /queue has changed/
    expect(() => dispatcher.requeue(['XYZ'])).toThrow(refusal)
    expect(() => dispatcher.requeue(['XYZ', 'OPS', 'ABC'])).toThrow(refusal)
    expect(() => dispatcher.requeue(['XYZ', 'XYZ'])).toThrow(refusal)
    expect(dispatcher.state.queue).toEqual(['XYZ', 'OPS'])
    expect(saved.length).toBe(before)
  })

  it('rejects an unknown project', async () => {
    const { dispatcher } = setup()
    await expect(dispatcher.start('QQQ')).rejects.toThrow('QQQ is not a configured project')
  })

  it('keeps a manual order and refuses one that breaks a blocker', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3', todo, 'ABC-2')])
    expect(() => dispatcher.reorder('ABC', ['ABC-3', 'ABC-2', 'ABC-1'])).toThrow(/ABC-3 cannot go before ABC-2/)

    dispatcher.reorder('ABC', ['ABC-2', 'ABC-3', 'ABC-1'])
    expect(dispatcher.orders().ABC).toEqual({ order: ['ABC-2', 'ABC-3', 'ABC-1'], waiting: [], backlog: [], error: null })
    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-2'])
  })

  it('saves every change and picks up where it left off after a restart', async () => {
    const first = setup()
    first.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    first.dispatcher.setTasks('XYZ', [task('XYZ-1')])
    first.dispatcher.start('ABC')
    first.dispatcher.start('XYZ')
    await first.dispatcher.idle()
    pause(first.dispatcher, 'ABC')
    await first.dispatcher.idle()
    const persisted = first.saved.at(-1)
    expect(persisted).toEqual(first.dispatcher.state)

    const second = setup({ state: persisted })
    second.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    second.dispatcher.resume('ABC')
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
      active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: null, since: 'x' }, paused: false, error: null }],
    }
    const { dispatcher, launched } = setup({ state })
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, current: null })
    expect(dispatcher.state.active[0]?.error).toEqual(notice('chain.interrupted', { task: 'ABC-1' }))
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

  it('puts a new task behind the more urgent ones of a manual order', () => {
    const { dispatcher } = setup()
    const urgent = (id: string): Task =>({ ...task(id), priority: 'urgent' })
    dispatcher.setTasks('ABC', [urgent('ABC-1'), task('ABC-2'), urgent('ABC-3')])
    dispatcher.reorder('ABC', ['ABC-3', 'ABC-1', 'ABC-2'])
    dispatcher.setTasks('ABC', [urgent('ABC-1'), task('ABC-2'), urgent('ABC-3'), { ...task('ABC-4'), priority: 'high' }])
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-3', 'ABC-1', 'ABC-4', 'ABC-2'])
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

  it('puts a task postponed on a backlog blocker below the running one and takes a new order after it', async () => {
    const { dispatcher, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-1', todo, 'ABC-9'), task('ABC-2'), task('ABC-3'), task('ABC-9', backlog)])
    await dispatcher.idle()

    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-2', 'ABC-1', 'ABC-3'])
    dispatcher.reorder('ABC', ['ABC-2', 'ABC-3', 'ABC-1'])
    expect(dispatcher.orders().ABC?.order).toEqual(['ABC-2', 'ABC-3', 'ABC-1'])
  })

  it('takes an order with only held tasks above the running one', async () => {
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1', todo, 'ABC-9'), task('ABC-2'), task('ABC-3'), task('ABC-9', backlog)])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.reorder('ABC', ['ABC-1', 'ABC-2', 'ABC-3'])
    expect(dispatcher.state.orders.ABC).toEqual(['ABC-1', 'ABC-2', 'ABC-3'])
    expect(() => dispatcher.reorder('ABC', ['ABC-1', 'ABC-3', 'ABC-2'])).toThrow('ABC-2 is running and stays first')
    expect(() => dispatcher.reorder('ABC', ['ABC-1', 'ABC-3'])).toThrow('ABC-2 is running and stays first')
  })
})
