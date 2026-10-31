import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_RULES } from '../chain/rules.js'
import { taskControl } from './control.js'
import { TrackerLink } from './link.js'
import { toTask, type TaskStatus } from './model.js'
import { trackerOf, type TaskSource } from './source.js'

function fixture(relabel?: TaskSource['relabel'], connectionError?: Error, refresh?: () => Promise<void>) {
  const raw = { id: 'APP-1', title: 'Example', status: { name: 'Todo', category: 'ToDo' as const }, blockedBy: [], parent: null, subtasks: 0, milestone: null, priority: 'none' as const, estimate: null, labels: ['Old'] }
  let listed = [toTask(raw)]
  const set = vi.fn((_reader, tasks) => { listed = tasks })
  const setTasks = vi.fn()
  const broadcast = vi.fn()
  const source: TaskSource = { chainTasks: async () => ({ tasks: [], statuses: [] }), tasks: async () => [], close: async () => {}, ...(relabel === undefined ? {} : { relabel }) }
  const link = new TrackerLink({ name: 'example', connect: async () => {
    if (connectionError !== undefined) throw connectionError
    return trackerOf(source)
  }, timeoutMs: 1000 })
  const control = taskControl({
    configuredProject: (task) => task.startsWith('APP-') ? 'owner' : undefined, live: () => false,
    linkFor: () => link, readerFor: () => 'feed', rulesOf: () => DEFAULT_RULES,
    refreshers: new Map(refresh === undefined ? [] : [['feed', refresh]]), readerTasks: { get: () => listed, set, setTasks },
    refreshProject: async () => true, pollReviews: async () => {}, broadcast,
  })
  return { control, listed: () => listed, set, setTasks, broadcast }
}

describe('task label controls', () => {
  it('refreshes through the normal entry path when available, so new admissions get their milestone first', async () => {
    const relabel = vi.fn(async () => ['Ready'])
    const refresh = vi.fn(async () => {})
    const { control, set, setTasks } = fixture(relabel, undefined, refresh)
    await control.relabel('APP-1', { add: ['Ready'], remove: [] })
    expect(relabel).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledOnce()
    expect(set).not.toHaveBeenCalled()
    expect(setTasks).not.toHaveBeenCalled()
  })

  it('immediately updates the feed, chain and derived question/model fields with the tracker result', async () => {
    const relabel = vi.fn(async () => ['Question', 'Codex | gpt-example'])
    const { control, listed, setTasks, broadcast } = fixture(relabel)
    await control.relabel('APP-1', { add: ['Question', 'Codex | gpt-example'], remove: ['Old'] })
    expect(listed()[0]).toMatchObject({ labels: ['Question', 'Codex | gpt-example'], question: true, runLabels: [{ provider: 'codex', model: 'gpt-example' }] })
    expect(setTasks).toHaveBeenCalledWith('feed', listed())
    expect(broadcast).toHaveBeenCalledOnce()
  })

  it('returns a notice code on refusal and keeps the current labels', async () => {
    const { control, listed, set, broadcast } = fixture(async () => { throw new Error('HTTP 403 private detail') })
    await expect(control.relabel('APP-1', { add: ['New'], remove: [] })).rejects.toMatchObject({ notice: { code: 'task.relabelFailed', params: { task: 'APP-1' } } })
    expect(listed()[0]!.labels).toEqual(['Old'])
    expect(set).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('distinguishes an unsupported operation from a task with no tracker', async () => {
    const { control } = fixture()
    await expect(control.relabel('APP-1', { add: [], remove: [] })).rejects.toMatchObject({ notice: { code: 'task.cannotRelabel' } })
    await expect(control.relabel('OTHER-1', { add: [], remove: [] })).rejects.toMatchObject({ notice: { code: 'task.noTracker' } })
  })

  it('also returns a notice code when connecting to the tracker fails', async () => {
    const { control, set } = fixture(undefined, new Error('HTTP 401 private detail'))
    await expect(control.relabel('APP-1', { add: [], remove: [] })).rejects.toMatchObject({ notice: { code: 'task.relabelFailed' } })
    expect(set).not.toHaveBeenCalled()
  })
})

describe('the moves between the backlog and the chain', () => {
  const RULES = { ...DEFAULT_RULES, requiredLabels: ['Ready', 'Go'] }

  function moves(extra: Partial<TaskSource>, options: { status?: TaskStatus; labels?: string[]; live?: boolean } = {}) {
    const raw = { id: 'APP-1', title: 'Example', status: options.status ?? { name: 'Todo', category: 'ToDo' as const }, blockedBy: [], parent: null, subtasks: 0, milestone: null, priority: 'none' as const, estimate: null, labels: options.labels ?? ['Old'] }
    let listed = [toTask(raw)]
    const source: TaskSource = { chainTasks: async () => ({ tasks: [], statuses: [] }), tasks: async () => [], close: async () => {}, ...extra }
    const link = new TrackerLink({ name: 'example', connect: async () => trackerOf(source), timeoutMs: 1000 })
    const control = taskControl({
      configuredProject: () => 'owner', live: () => options.live ?? false,
      linkFor: () => link, readerFor: () => 'feed', rulesOf: () => RULES,
      refreshers: new Map(), readerTasks: { get: () => listed, set: (_reader, tasks) => { listed = tasks }, setTasks: () => {} },
      refreshProject: async () => true, pollReviews: async () => {}, broadcast: () => {},
    })
    return { control, task: () => listed[0]! }
  }

  it('puts the first required label on a task without one where the tracker has no backlog status', async () => {
    const relabel = vi.fn(async () => ['Old', 'Ready'])
    const { control, task } = moves({ relabel })
    await control.ready('APP-1')
    expect(relabel).toHaveBeenCalledWith('APP-1', { add: ['Ready'], remove: [] })
    expect(task().labels).toEqual(['Old', 'Ready'])
  })

  it('also moves the task out of the backlog status, and only that for a task already labelled', async () => {
    const todo: TaskStatus = { name: 'Todo', category: 'ToDo' }
    const relabel = vi.fn(async () => ['Go'])
    const { control, task } = moves({ relabel, ready: async () => todo }, { status: { name: 'Backlog', category: 'UnStarted' }, labels: ['Go'] })
    await control.ready('APP-1')
    expect(relabel).not.toHaveBeenCalled()
    expect(task().status).toEqual(todo)
  })

  it('refuses "Into the chain" when the tracker can do nothing the task needs', async () => {
    await expect(moves({}).control.ready('APP-1')).rejects.toMatchObject({ notice: { code: 'task.cannotReady' } })
    await expect(moves({ ready: async () => null }, { labels: ['Ready'] }).control.ready('APP-1')).rejects.toMatchObject({ notice: { code: 'task.pastBacklog' } })
  })

  it('takes the required labels off and moves the task back to the backlog status', async () => {
    const backlog: TaskStatus = { name: 'Backlog', category: 'UnStarted' }
    const relabel = vi.fn(async () => ['Old'])
    const { control, task } = moves({ relabel, unready: async () => backlog }, { labels: ['Old', 'ready', 'Go'] })
    await control.unready('APP-1')
    expect(relabel).toHaveBeenCalledWith('APP-1', { add: [], remove: ['ready', 'Go'] })
    expect(task()).toMatchObject({ labels: ['Old'], status: backlog })
  })

  it('refuses "To the backlog" for a task with a live session, a tracker that cannot, or a task there already', async () => {
    const relabel = vi.fn(async () => [])
    await expect(moves({ relabel }, { labels: ['Ready'], live: true }).control.unready('APP-1')).rejects.toMatchObject({ notice: { code: 'task.unreadyLive' } })
    expect(relabel).not.toHaveBeenCalled()
    await expect(moves({}, { labels: ['Ready'] }).control.unready('APP-1')).rejects.toMatchObject({ notice: { code: 'task.cannotUnready' } })
    await expect(moves({ unready: async () => null }).control.unready('APP-1')).rejects.toMatchObject({ notice: { code: 'task.inBacklog' } })
  })
})
