import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_RULES } from '../chain/rules.js'
import { taskControl } from './control.js'
import { TrackerLink } from './link.js'
import { toTask } from './model.js'
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
    configuredProject: (task) => task.startsWith('APP-') ? 'owner' : undefined,
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
