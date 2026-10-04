import { describe, expect, it } from 'vitest'
import { closingStatus, labeled, milestonesOf, missingBlockers, toTasks, type HulyIssueDoc, type HulyStatusDoc } from './model.js'

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
      {
        id: 'ABC-1',
        title: 'Title of ABC-1',
        status: { name: 'In Review', category: 'Active' },
        blockedBy: [],
        parent: null,
        subtasks: 0,
        milestone: null,
        priority: 'none',
        labels: [],
        estimate: null,
      },
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

  it('gathers the label titles of each issue', () => {
    const issues = ['i1', 'i2'].map((id, index) => issue(id, `ABC-${index + 1}`, 'tracker:status:Todo'))
    const labels = [
      { attachedTo: 'i1', title: 'Sonnet' },
      { attachedTo: 'i1', title: 'Bug' },
    ]
    expect(toTasks(issues, statuses, new Map(), [], labels).map((task) => task.labels)).toEqual([['Sonnet', 'Bug'], []])
  })

  it('reads the direct parent, the number of sub-issues and the estimate, an estimate of 0 is none', () => {
    const issues: HulyIssueDoc[] = [
      { ...issue('i1', 'ABC-1', 'tracker:status:Todo'), subIssues: 2, estimation: 0 },
      { ...issue('i2', 'ABC-2', 'tracker:status:Todo'), parents: [{ identifier: 'ABC-1' }, { identifier: 'ABC-0' }], estimation: 1.5 },
    ]
    const tasks = toTasks(issues, statuses, new Map(), [])
    expect(tasks.map(({ parent, subtasks, estimate }) => ({ parent, subtasks, estimate }))).toEqual([
      { parent: null, subtasks: 2, estimate: null },
      { parent: 'ABC-1', subtasks: 0, estimate: 1.5 },
    ])
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

describe('closingStatus', () => {
  const custom: HulyStatusDoc = { _id: 'custom-shipped', name: 'Shipped', category: 'task:statusCategory:Won' }

  it('moves an open issue to the Won status of its project', () => {
    expect(closingStatus('tracker:status:InProgress', statuses, null)).toBe('tracker:status:Done')
    expect(closingStatus('custom-review', [...statuses, custom], ['tracker:status:Todo', 'custom-shipped'])).toBe('custom-shipped')
  })

  it('leaves an issue that is already done or canceled alone', () => {
    expect(closingStatus('tracker:status:Done', statuses, null)).toBeNull()
    expect(closingStatus('tracker:status:Canceled', statuses, null)).toBeNull()
  })

  it('fails when the project has no Won status', () => {
    expect(() => closingStatus('tracker:status:Todo', statuses, ['tracker:status:Todo'])).toThrow(/no done status/)
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
