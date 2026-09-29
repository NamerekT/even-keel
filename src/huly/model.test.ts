import { describe, expect, it } from 'vitest'
import { diffStatuses, isOpen, labeled, milestonesOf, missingBlockers, toTasks, withoutParents, type HulyIssueDoc, type HulyStatusDoc, type HulyTask } from './model.js'

const statuses: HulyStatusDoc[] = [
  { _id: 'tracker:status:Backlog', name: 'Backlog', category: 'task:statusCategory:UnStarted' },
  { _id: 'tracker:status:Todo', name: 'Todo', category: 'task:statusCategory:ToDo' },
  { _id: 'tracker:status:InProgress', name: 'In Progress', category: 'task:statusCategory:Active' },
  { _id: 'custom-review', name: 'In Review', category: 'task:statusCategory:Active' },
  { _id: 'tracker:status:Done', name: 'Done', category: 'task:statusCategory:Won' },
  { _id: 'tracker:status:Canceled', name: 'Canceled', category: 'task:statusCategory:Lost' },
]

const issue = (id: string, identifier: string, status: string, blockedBy?: string[]): HulyIssueDoc => ({
  _id: id,
  identifier,
  title: `Title of ${identifier}`,
  status,
  ...(blockedBy === undefined ? {} : { blockedBy: blockedBy.map((_id) => ({ _id, _class: 'tracker:class:Issue' })) }),
})

describe('toTasks', () => {
  it('maps an issue to a task with its status name and category', () => {
    const tasks = toTasks([issue('i1', 'ABC-1', 'custom-review')], statuses, new Map(), [])
    expect(tasks).toEqual([
      { id: 'ABC-1', title: 'Title of ABC-1', status: { name: 'In Review', category: 'Active' }, blockedBy: [], milestone: null, priority: 'none', question: false, labels: [], models: [] },
    ])
  })

  it('reads the Huly priority and treats an unknown one as none', () => {
    const issues = [undefined, 0, 1, 2, 3, 4, 7].map((priority, index) => ({
      ...issue(`i${index}`, `ABC-${index}`, 'tracker:status:Todo'),
      ...(priority === undefined ? {} : { priority }),
    }))
    const tasks = toTasks(issues, statuses, new Map(), [])
    expect(tasks.map((task) => task.priority)).toEqual(['none', 'none', 'urgent', 'high', 'medium', 'low', 'none'])
  })

  it('reads model labels whatever their case and spacing, once each and in a fixed order', () => {
    const issues = ['i1', 'i2', 'i3', 'i4'].map((id, index) => issue(id, `ABC-${index + 1}`, 'tracker:status:Todo'))
    const labels = [
      { attachedTo: 'i1', title: 'Sonnet' },
      { attachedTo: 'i2', title: ' OPUS ' },
      { attachedTo: 'i3', title: 'Opus' },
      { attachedTo: 'i3', title: 'haiku' },
      { attachedTo: 'i3', title: 'opus' },
      { attachedTo: 'i4', title: 'Sonnet 4' },
      { attachedTo: 'i4', title: 'Bug' },
    ]
    const tasks = toTasks(issues, statuses, new Map(), [], labels)
    expect(tasks.map((task) => task.models)).toEqual([['sonnet'], ['opus'], ['opus', 'haiku'], []])
  })

  it('marks an issue carrying the question label, whatever its case and spacing', () => {
    const issues = ['i1', 'i2', 'i3'].map((id, index) => issue(id, `ABC-${index + 1}`, 'tracker:status:Todo'))
    const labels = [
      { attachedTo: 'i1', title: 'Вопрос' },
      { attachedTo: 'i2', title: 'Bug' },
      { attachedTo: 'i3', title: ' вопрос ' },
    ]
    const tasks = toTasks(issues, statuses, new Map(), [], labels)
    expect(tasks.map((task) => task.question)).toEqual([true, false, true])
  })

  it('keeps the labels of an issue trimmed, once each whatever the case', () => {
    const issues = ['i1', 'i2'].map((id, index) => issue(id, `ABC-${index + 1}`, 'tracker:status:Todo'))
    const labels = [
      { attachedTo: 'i1', title: ' Вручную ' },
      { attachedTo: 'i1', title: 'Bug' },
      { attachedTo: 'i1', title: 'вручную' },
    ]
    const tasks = toTasks(issues, statuses, new Map(), [], labels)
    expect(tasks.map((task) => task.labels)).toEqual([['Вручную', 'Bug'], []])
  })

  it('resolves blockers to identifiers from the issues themselves and from the extra lookup', () => {
    const tasks = toTasks(
      [issue('i1', 'ABC-1', 'tracker:status:Backlog'), issue('i2', 'ABC-2', 'tracker:status:Todo', ['i1', 'i0'])],
      statuses,
      new Map([['i0', 'ABC-0']]),
      [],
    )
    expect(tasks[1]?.blockedBy).toEqual(['ABC-1', 'ABC-0'])
  })

  it('drops blockers that no longer exist', () => {
    const tasks = toTasks([issue('i2', 'ABC-2', 'tracker:status:Todo', ['gone'])], statuses, new Map(), [])
    expect(tasks[0]?.blockedBy).toEqual([])
  })

  it('attaches the milestone of an issue and leaves it null when missing or unknown', () => {
    const issues = [
      { ...issue('i1', 'ABC-1', 'tracker:status:Todo'), milestone: 'm1' },
      { ...issue('i2', 'ABC-2', 'tracker:status:Todo'), milestone: null },
      { ...issue('i3', 'ABC-3', 'tracker:status:Todo'), milestone: 'gone' },
    ]
    const tasks = toTasks(issues, statuses, new Map(), [{ _id: 'm1', label: 'v0.1', targetDate: 1000 }])
    expect(tasks.map((task) => task.milestone)).toEqual([{ label: 'v0.1', targetDate: 1000 }, null, null])
  })

  it('fails loudly on a status it does not know', () => {
    expect(() => toTasks([issue('i1', 'ABC-1', 'nope')], statuses, new Map(), [])).toThrow(/ABC-1.*nope/)
  })

  it('fails loudly on a status without a known category', () => {
    const odd = [...statuses, { _id: 'odd', name: 'Odd', category: 'task:statusCategory:Weird' }]
    expect(() => toTasks([issue('i1', 'ABC-1', 'odd')], odd, new Map(), [])).toThrow(/Odd/)
  })
})

describe('missingBlockers', () => {
  it('lists blocker ids that are not among the fetched issues, once each', () => {
    const issues = [
      issue('i1', 'ABC-1', 'tracker:status:Backlog', ['i0']),
      issue('i2', 'ABC-2', 'tracker:status:Todo', ['i1', 'i0', 'i9']),
    ]
    expect(missingBlockers(issues)).toEqual(['i0', 'i9'])
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
  const task = (id: string, name: string, category: HulyTask['status']['category']): HulyTask => ({
    id,
    title: id,
    status: { name, category },
    blockedBy: [],
    milestone: null,
    priority: 'none',
    question: false,
    labels: [],
    models: [],
  })
  const todo = { name: 'Todo', category: 'ToDo' } as const
  const done = { name: 'Done', category: 'Won' } as const

  it('reports a status that moved', () => {
    const known = new Map([['ABC-1', todo]])
    expect(diffStatuses(known, [task('ABC-1', 'Done', 'Won')], ['ABC-1'])).toEqual([
      { id: 'ABC-1', from: todo, to: done },
    ])
  })

  it('stays quiet when nothing moved', () => {
    const known = new Map([['ABC-1', todo]])
    expect(diffStatuses(known, [task('ABC-1', 'Todo', 'ToDo')], ['ABC-1'])).toEqual([])
  })

  it('reports a task seen for the first time', () => {
    expect(diffStatuses(new Map(), [task('ABC-1', 'Todo', 'ToDo')], ['ABC-1'])).toEqual([
      { id: 'ABC-1', from: null, to: todo },
    ])
  })

  it('reports a watched task that vanished from Huly', () => {
    const known = new Map([['ABC-1', todo]])
    expect(diffStatuses(known, [], ['ABC-1'])).toEqual([{ id: 'ABC-1', from: todo, to: null }])
  })

  it('ignores tasks that are no longer watched', () => {
    const known = new Map([['ABC-1', todo]])
    expect(diffStatuses(known, [], [])).toEqual([])
  })
})

describe('milestonesOf', () => {
  it('lists each milestone of the given issues once, skipping issues without one', () => {
    const issues: HulyIssueDoc[] = [
      { ...issue('i1', 'ABC-1', 'tracker:status:Todo'), milestone: 'm1' },
      { ...issue('i2', 'ABC-2', 'tracker:status:Todo'), milestone: 'm2' },
      { ...issue('i3', 'ABC-3', 'tracker:status:Todo'), milestone: 'm1' },
      { ...issue('i4', 'ABC-4', 'tracker:status:Todo'), milestone: null },
      issue('i5', 'ABC-5', 'tracker:status:Todo'),
    ]
    expect(milestonesOf(issues)).toEqual(['m1', 'm2'])
  })
})

describe('labeled', () => {
  it('lists the ids of issues that carry any label', () => {
    const issues: HulyIssueDoc[] = [
      { ...issue('i1', 'ABC-1', 'tracker:status:Todo'), labels: 2 },
      { ...issue('i2', 'ABC-2', 'tracker:status:Todo'), labels: 0 },
      issue('i3', 'ABC-3', 'tracker:status:Todo'),
    ]
    expect(labeled(issues)).toEqual(['i1'])
  })
})

describe('withoutParents', () => {
  it('drops issues that have sub-issues and keeps the rest', () => {
    const issues: HulyIssueDoc[] = [
      { ...issue('i1', 'ABC-1', 'tracker:status:Todo'), subIssues: 2 },
      { ...issue('i2', 'ABC-2', 'tracker:status:Todo'), subIssues: 0 },
      issue('i3', 'ABC-3', 'tracker:status:Todo'),
    ]
    expect(withoutParents(issues).map((doc) => doc.identifier)).toEqual(['ABC-2', 'ABC-3'])
  })

  it('drops a parent even when it is already closed', () => {
    const closedParent: HulyIssueDoc = { ...issue('i1', 'ABC-1', 'tracker:status:Done'), subIssues: 1 }
    expect(withoutParents([closedParent])).toEqual([])
  })
})
