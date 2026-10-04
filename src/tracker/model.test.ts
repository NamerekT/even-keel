import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../chain/rules.js'
import { fakeTask } from './fixture.js'
import { diffStatuses, isOpen, toTask, type TaskStatus, type TrackerTask } from './model.js'
import { trackerOf, type TaskSource } from './source.js'

const todo: TaskStatus = { name: 'Todo', category: 'ToDo' }
const done: TaskStatus = { name: 'Done', category: 'Won' }

const raw = (id: string, fields: Partial<TrackerTask> = {}): TrackerTask => {
  const { question: _question, models: _models, ...task } = fakeTask(id)
  return { ...task, ...fields }
}

describe('toTask', () => {
  it('reads model labels whatever their case and spacing, once each and in a fixed order', () => {
    const tasks = [['Sonnet'], [' OPUS '], ['Opus', 'haiku', 'opus'], ['Sonnet 4', 'Bug']].map((labels, index) =>
      toTask(raw(`ABC-${index + 1}`, { labels })),
    )
    expect(tasks.map((task) => task.models)).toEqual([['sonnet'], ['opus'], ['opus', 'haiku'], []])
  })

  it('marks a task carrying the question label, whatever its case and spacing', () => {
    const tasks = [['Вопрос'], ['Bug'], [' вопрос ']].map((labels, index) => toTask(raw(`ABC-${index + 1}`, { labels })))
    expect(tasks.map((task) => task.question)).toEqual([true, false, true])
  })

  it('takes the English question label as well', () => {
    const tasks = [['Question'], [' question '], ['Questions']].map((labels, index) => toTask(raw(`ABC-${index + 1}`, { labels })))
    expect(tasks.map((task) => task.question)).toEqual([true, true, false])
  })

  it('keeps the labels trimmed, once each whatever the case', () => {
    expect(toTask(raw('ABC-1', { labels: [' Вручную ', 'Bug', 'вручную', ' '] })).labels).toEqual(['Вручную', 'Bug'])
  })
})

describe('isOpen', () => {
  it('treats Won and Lost as closed and everything else as open', () => {
    expect(isOpen({ name: 'Backlog', category: 'UnStarted' })).toBe(true)
    expect(isOpen({ name: 'In Review', category: 'Active' })).toBe(true)
    expect(isOpen({ name: 'Done', category: 'Won' })).toBe(false)
    expect(isOpen({ name: 'Canceled', category: 'Lost' })).toBe(false)
  })
})

describe('diffStatuses', () => {
  const task = (id: string, status: TaskStatus) => fakeTask(id, { status })

  it('reports a status that moved', () => {
    const known = new Map([['ABC-1', todo]])
    expect(diffStatuses(known, [task('ABC-1', done)], ['ABC-1'])).toEqual([{ id: 'ABC-1', from: todo, to: done }])
  })

  it('stays quiet when nothing moved', () => {
    const known = new Map([['ABC-1', todo]])
    expect(diffStatuses(known, [task('ABC-1', { ...todo })], ['ABC-1'])).toEqual([])
  })

  it('reports a task seen for the first time', () => {
    expect(diffStatuses(new Map(), [task('ABC-1', todo)], ['ABC-1'])).toEqual([{ id: 'ABC-1', from: null, to: todo }])
  })

  it('reports a watched task that vanished from the tracker', () => {
    const known = new Map([['ABC-1', todo]])
    expect(diffStatuses(known, [], ['ABC-1'])).toEqual([{ id: 'ABC-1', from: todo, to: null }])
  })

  it('ignores tasks that are no longer watched', () => {
    const known = new Map([['ABC-1', todo]])
    expect(diffStatuses(known, [], [])).toEqual([])
  })
})

describe('trackerOf', () => {
  const source = (tasks: TrackerTask[]): TaskSource & { asked: TaskStatus[] } => {
    const asked: TaskStatus[] = []
    return {
      asked,
      async chainTasks(_project, open) {
        for (const status of [todo, done]) if (open(status)) asked.push(status)
        return { tasks, statuses: ['Todo', 'Done'] }
      },
      tasks: async () => tasks,
      close: async () => {},
    }
  }

  it('leaves parents out of the chain, derives labels and asks for open statuses by the rules', async () => {
    const adapter = source([raw('ABC-1', { subtasks: 2 }), raw('ABC-2', { parent: 'ABC-1', labels: ['Sonnet'] })])
    const { tasks, unknownStatuses } = await trackerOf(adapter).chainTasks('ABC', { ...DEFAULT_RULES, active: ['Review'] })
    expect(tasks.map((task) => [task.id, task.models])).toEqual([['ABC-2', ['sonnet']]])
    expect(unknownStatuses).toEqual(['Review'])
    expect(adapter.asked).toEqual([todo])
  })

  it('keeps parents among tasks asked for by id', async () => {
    expect((await trackerOf(source([raw('ABC-1', { subtasks: 2 })])).tasks(['ABC-1'])).map((task) => task.id)).toEqual(['ABC-1'])
  })

  it('passes the optional brief and completion through only when the adapter has them', async () => {
    const plain = trackerOf(source([]))
    expect(plain.brief).toBeUndefined()
    expect(plain.complete).toBeUndefined()

    const completed: string[] = []
    const full = trackerOf({
      ...source([]),
      brief: async (id) => ({ title: `Title of ${id}`, description: '' }),
      complete: async (id) => completed.push(id) > 0,
    })
    expect(await full.brief!('ABC-1')).toEqual({ title: 'Title of ABC-1', description: '' })
    expect(await full.complete!('ABC-1')).toBe(true)
    expect(completed).toEqual(['ABC-1'])
  })
})
