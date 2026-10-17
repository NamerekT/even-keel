import { describe, expect, it } from 'vitest'
import { done, setup, todo } from '../chain/dispatcher.fixture.js'
import { MergeCloser } from './closer.js'
import { fakeTask } from './fixture.js'
import type { TaskStatus, TrackerTask } from './model.js'
import { trackerOf, type TaskSource } from './source.js'

function fakeAdapter(ids: string[]): TaskSource & { statuses: Map<string, TaskStatus> } {
  const statuses = new Map(ids.map((id) => [id, todo]))
  const raw = (id: string): TrackerTask => {
    const { question: _question, runLabels: _runLabels, ...task } = fakeTask(id, { status: statuses.get(id)! })
    return task
  }
  return {
    statuses,
    chainTasks: async (_project, open) => ({ tasks: ids.filter((id) => open(statuses.get(id)!)).map(raw), statuses: ['Todo', 'Done'] }),
    tasks: async (wanted) => wanted.filter((id) => statuses.has(id)).map(raw),
    complete: async (id) => {
      if (statuses.get(id) === done) return false
      statuses.set(id, done)
      return true
    },
    close: async () => {},
  }
}

describe('MergeCloser', () => {
  it('closes the current task once its branch is merged, and the chain cleans up and goes on', async () => {
    const adapter = fakeAdapter(['ABC-1', 'ABC-2'])
    const tracker = trackerOf(adapter)
    const { dispatcher, launched, finished } = setup()
    const refresh = async () => dispatcher.setTasks('ABC', (await tracker.tasks(['ABC-1', 'ABC-2'])))
    await refresh()
    dispatcher.start('ABC')
    await dispatcher.idle()

    const merged = new Set<string>()
    const closer = new MergeCloser({ merged: async (_project, task) => merged.has(task), complete: (task) => tracker.complete!(task) })
    expect(await closer.sweep('ABC', dispatcher.held('ABC'))).toEqual([])
    expect(adapter.statuses.get('ABC-1')).toEqual(todo)

    merged.add('ABC-1')
    expect(await closer.sweep('ABC', dispatcher.held('ABC'))).toEqual(['ABC-1'])
    expect(adapter.statuses.get('ABC-1')).toEqual(done)

    await refresh()
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('closes a released task too, and closes each task once', async () => {
    const { dispatcher } = setup()
    dispatcher.setTasks('ABC', [fakeTask('ABC-1'), fakeTask('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.skip('ABC', 'ABC-1')
    await dispatcher.idle()
    expect(dispatcher.held('ABC')).toEqual(['ABC-2', 'ABC-1'])

    const completed: string[] = []
    const closer = new MergeCloser({
      merged: async (_project, task) => task === 'ABC-1',
      complete: async (task) => completed.push(task) > 0,
    })
    await closer.sweep('ABC', dispatcher.held('ABC'))
    await closer.sweep('ABC', dispatcher.held('ABC'))
    expect(completed).toEqual(['ABC-1'])
  })

  it('does not report a task something else closed first, and does not ask about it again', async () => {
    const adapter = fakeAdapter(['ABC-1'])
    adapter.statuses.set('ABC-1', done)
    let asked = 0
    const closer = new MergeCloser({
      merged: async () => true,
      complete: (task) => {
        asked++
        return adapter.complete!(task)
      },
    })
    expect(await closer.sweep('ABC', ['ABC-1'])).toEqual([])
    expect(await closer.sweep('ABC', ['ABC-1'])).toEqual([])
    expect(asked).toBe(1)
  })

  it('tries again next time when the tracker refused to close the task', async () => {
    let fail = true
    const errors: unknown[] = []
    const completed: string[] = []
    const closer = new MergeCloser({
      merged: async () => true,
      complete: async (task) => {
        if (fail) throw new Error('tracker: refused')
        completed.push(task)
        return true
      },
      onError: (error) => errors.push(error),
    })
    expect(await closer.sweep('ABC', ['ABC-1'])).toEqual([])
    expect(errors).toHaveLength(1)
    fail = false
    expect(await closer.sweep('ABC', ['ABC-1'])).toEqual(['ABC-1'])
    expect(completed).toEqual(['ABC-1'])
  })
})
