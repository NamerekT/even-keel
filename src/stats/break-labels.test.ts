import { describe, expect, it, vi } from 'vitest'
import type { TaskSource } from '../tracker/source.js'
import type { TrackerTask } from '../tracker/model.js'
import { assignBreakLabels, breakLabelOf, selectProjects } from './break-labels.js'

const compaction = 'Разрыв | компакция'
const handoff = 'Разрыв | хендофф'
const task = (number: number, labels: string[] = [], category: TrackerTask['status']['category'] = 'ToDo'): TrackerTask => ({
  id: `APP-${number}`, title: 'Example', status: { name: category, category }, labels,
  blockedBy: [], parent: null, subtasks: 0, milestone: null, priority: 'none', estimate: null,
})

describe('break group assignment', () => {
  it('assigns even numbers to compaction and odd numbers to handoff, including large identifiers', () => {
    expect(breakLabelOf('APP-2', [])).toEqual({ expected: compaction, actual: [] })
    expect(breakLabelOf('APP-3', [])).toEqual({ expected: handoff, actual: [] })
    expect(breakLabelOf('APP-9007199254740993', []).expected).toBe(handoff)
    expect(() => breakLabelOf('APP-invalid', [])).toThrow('number')
  })

  it('preserves any existing break label and both labels, regardless of parity or case', () => {
    expect(breakLabelOf('APP-2', ['Bug', handoff])).toEqual({ expected: compaction, actual: [handoff] })
    expect(breakLabelOf('APP-3', [compaction, handoff]).actual).toEqual([compaction, handoff])
    expect(breakLabelOf('APP-2', ['  РАЗРЫВ | КОМПАКЦИЯ  ']).actual).toHaveLength(1)
  })

  it('resolves GUIDs and unique keys, deduplicates, and rejects ambiguous or unknown projects', () => {
    const keys = { first: 'APP', second: 'APP', third: 'OTHER' }
    expect(selectProjects(keys, ['first', 'OTHER', 'first'])).toEqual(['first', 'third'])
    expect(() => selectProjects(keys, ['APP'])).toThrow('ambiguous')
    expect(() => selectProjects(keys, ['missing'])).toThrow('Unknown')
    expect(() => selectProjects(keys, [])).toThrow('project')
  })

  it('includes backlog and parents, skips terminal tasks, and makes no writes on a second sweep', async () => {
    const tasks = [task(2, ['Bug'], 'UnStarted'), { ...task(3), subtasks: 2 }, task(4, [], 'Won'),
      task(5, [], 'Lost'), task(6, [handoff]), task(7, [compaction, handoff])]
    const relabel = vi.fn(async (id, change) => {
      const current = tasks.find((each) => each.id === id)!
      current.labels.push(...change.add)
      return current.labels
    })
    const source = {
      chainTasks: vi.fn(async (_project, open) => {
        expect(open(task(1, [], 'UnStarted').status)).toBe(true)
        expect(open(task(1, [], 'Won').status)).toBe(false)
        return { tasks, statuses: [] }
      }),
      tasks: async (ids) => tasks.filter((each) => ids.includes(each.id)), relabel,
    } as Pick<TaskSource, 'chainTasks' | 'tasks' | 'relabel'>
    const log = vi.fn()
    await assignBreakLabels(source, 'project', false, log)
    await assignBreakLabels(source, 'project', false, log)
    expect(relabel.mock.calls).toEqual([
      ['APP-2', { add: [compaction], remove: [] }], ['APP-3', { add: [handoff], remove: [] }],
    ])
    expect(tasks[0]!.labels).toEqual(['Bug', compaction])
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ id: 'APP-6', action: 'existing', actual: [handoff], expected: compaction }))
  })

  it('checks fresh labels and status before writing and supports a read-only preview', async () => {
    const relabel = vi.fn(async () => [handoff])
    const source = {
      chainTasks: async () => ({ tasks: [task(2), task(3), task(4), task(5)], statuses: [] }),
      tasks: async ([id]) => id === 'APP-2' ? [task(2, [handoff])] : id === 'APP-3' ? [task(3, [], 'Won')] : id === 'APP-4' ? [] : [task(5)],
      relabel,
    } as Pick<TaskSource, 'chainTasks' | 'tasks' | 'relabel'>
    const log = vi.fn()
    await assignBreakLabels(source, 'project', true, log)
    expect(relabel).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ id: 'APP-5', action: 'preview', expected: handoff }))
    await assignBreakLabels(source, 'project', false, log)
    expect(relabel).toHaveBeenCalledExactlyOnceWith('APP-5', { add: [handoff], remove: [] })
  })
})
