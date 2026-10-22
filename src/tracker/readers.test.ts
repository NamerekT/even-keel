import { describe, expect, it } from 'vitest'
import type { ChainView } from '../chain/milestones.js'
import { fakeTask as task } from './fixture.js'
import type { Task } from './model.js'
import { ReaderTasks } from './readers.js'

/** ABC reads its own tasks and those of the feed `gh`, whose ids are `ABCGH-<n>`. */
function setup(released: string[] = []) {
  const calls: { setTasks: [string, string[]][]; setOutside: [string, string[]][]; setReleased: [string, string[]][] } = { setTasks: [], setOutside: [], setReleased: [] }
  const tasksByProject = new Map<string, Task[]>()
  const view: ChainView = { tasks: [task('ABC-1'), task('ABCGH-2')], blockers: [task('ABCGH-3')], current: 'ABCGH-2' }
  const join = new ReaderTasks({
    owner: (reader) => (reader === 'gh' ? 'ABC' : reader),
    readers: (project) => (project === 'ABC' ? ['ABC', 'gh'] : [project]),
    belongs: (reader, id) => (reader === 'gh') === id.startsWith('ABCGH-'),
    tasksByProject,
    dispatcher: {
      setTasks: (project, tasks) => void calls.setTasks.push([project, tasks.map((each) => each.id)]),
      setOutside: (project, tasks) => void calls.setOutside.push([project, tasks.map((each) => each.id)]),
      released: () => released,
      setReleased: (project, tasks) => void calls.setReleased.push([project, tasks.map((each) => each.id)]),
      held: () => ['ABCGH-2', ...released],
      view: () => view,
    },
  })
  return { join, calls, tasksByProject }
}

describe('ReaderTasks', () => {
  it("gives the chain of a project the tasks of all its readers, the project's first", () => {
    const { join, calls, tasksByProject } = setup()
    join.set('gh', [task('ABCGH-2')])
    join.setTasks('gh', [task('ABCGH-2')])
    join.set('ABC', [task('ABC-1')])
    join.setTasks('ABC', [task('ABC-1')])

    expect(calls.setTasks).toEqual([
      ['ABC', ['ABCGH-2']],
      ['ABC', ['ABC-1', 'ABCGH-2']],
    ])
    expect(tasksByProject.get('ABC')?.map((each) => each.id)).toEqual(['ABC-1', 'ABCGH-2'])
    expect(join.get('gh')?.map((each) => each.id)).toEqual(['ABCGH-2'])
    expect(join.has('XYZ')).toBe(false)
  })

  it('joins the blockers outside the list the same way', () => {
    const { join, calls } = setup()
    join.setOutside('ABC', [task('XYZ-1')])
    join.setOutside('gh', [task('XYZ-2')])
    expect(calls.setOutside.at(-1)).toEqual(['ABC', ['XYZ-1', 'XYZ-2']])
  })

  it("splits the released, held and the chain's view by reader", () => {
    const { join } = setup(['ABC-4', 'ABCGH-5'])
    expect(join.released('ABC')).toEqual(['ABC-4'])
    expect(join.released('gh')).toEqual(['ABCGH-5'])
    expect(join.held('gh')).toEqual(['ABCGH-2', 'ABCGH-5'])
    expect(join.view('ABC')).toEqual({ tasks: [task('ABC-1')], blockers: [], current: undefined })
    expect(join.view('gh')).toEqual({ tasks: [task('ABCGH-2')], blockers: [task('ABCGH-3')], current: 'ABCGH-2' })
  })

  it('hands the released tasks to the chain once every reader with some has read them', () => {
    const { join, calls } = setup(['ABC-4', 'ABCGH-5'])
    join.setReleased('ABC', [task('ABC-4')])
    expect(calls.setReleased).toEqual([])
    join.setReleased('gh', [task('ABCGH-5')])
    expect(calls.setReleased).toEqual([['ABC', ['ABC-4', 'ABCGH-5']]])
  })

  it('forgets a reader that goes: its tasks leave the project, the project stays', () => {
    const { join, calls, tasksByProject } = setup()
    join.set('ABC', [task('ABC-1')])
    join.setTasks('ABC', [task('ABC-1')])
    join.set('gh', [task('ABCGH-2')])
    join.setTasks('gh', [task('ABCGH-2')])
    join.delete('gh')
    expect(tasksByProject.get('ABC')?.map((each) => each.id)).toEqual(['ABC-1'])
    expect(calls.setTasks.at(-1)).toEqual(['ABC', ['ABC-1']])
    join.delete('ABC')
    expect(tasksByProject.has('ABC')).toBe(false)
  })

  it('takes the tasks of a feed gone from the config out of the project it was read for', () => {
    let owner = 'ABC'
    const tasksByProject = new Map<string, Task[]>()
    const join = new ReaderTasks({
      owner: (reader) => (reader === 'gh' ? owner : reader),
      readers: (project) => (project === 'ABC' && owner === 'ABC' ? ['ABC', 'gh'] : [project]),
      belongs: () => true,
      tasksByProject,
      dispatcher: { setTasks: () => {}, setOutside: () => {}, released: () => [], setReleased: () => {}, held: () => [], view: () => ({ tasks: [], blockers: [], current: undefined }) },
    })
    join.set('ABC', [task('ABC-1')])
    join.set('gh', [task('ABCGH-2')])
    owner = 'gh'
    join.delete('gh')
    expect(tasksByProject.get('ABC')?.map((each) => each.id)).toEqual(['ABC-1'])
  })
})
