import { describe, expect, it } from 'vitest'
import {
  backlogStatus,
  cardLinks,
  closingStatus,
  labeled,
  latestMessages,
  milestonesOf,
  missingBlockers,
  hulyPriority,
  personName,
  readyStatus,
  toCard,
  toTasks,
  vocabularyOf,
  type HulyCardDocs,
  type HulyIssueDoc,
  type HulyStatusDoc,
} from './model.js'

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

  it('reads the direct parent (the last of the chain from the root), the number of sub-issues and the estimate, an estimate of 0 is none', () => {
    const issues: HulyIssueDoc[] = [
      { ...issue('i1', 'ABC-1', 'tracker:status:Todo'), subIssues: 2, estimation: 0 },
      { ...issue('i2', 'ABC-2', 'tracker:status:Todo'), parents: [{ identifier: 'ABC-0' }, { identifier: 'ABC-1' }], estimation: 1.5 },
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

describe('readyStatus', () => {
  const custom: HulyStatusDoc = { _id: 'custom-ready', name: 'Ready', category: 'task:statusCategory:ToDo' }

  it('moves a backlog issue to the first ToDo status of its project', () => {
    expect(readyStatus('tracker:status:Backlog', statuses, null)?._id).toBe('tracker:status:Todo')
    expect(readyStatus('tracker:status:Backlog', [...statuses, custom], ['tracker:status:Backlog', 'custom-ready', 'tracker:status:Todo'])?._id).toBe(
      'custom-ready',
    )
  })

  it('leaves an issue that is past the backlog alone', () => {
    expect(readyStatus('tracker:status:Todo', statuses, null)).toBeNull()
    expect(readyStatus('tracker:status:Done', statuses, null)).toBeNull()
  })

  it('fails when the project has no ToDo status', () => {
    expect(() => readyStatus('tracker:status:Backlog', statuses, ['tracker:status:Backlog'])).toThrow(/no ToDo status/)
  })
})

describe('backlogStatus', () => {
  it('moves a ready or started issue to the first backlog status of its project', () => {
    expect(backlogStatus('tracker:status:Todo', statuses, null)?._id).toBe('tracker:status:Backlog')
    expect(backlogStatus('tracker:status:InProgress', statuses, null)?._id).toBe('tracker:status:Backlog')
  })

  it('leaves an issue in the backlog or closed alone', () => {
    expect(backlogStatus('tracker:status:Backlog', statuses, null)).toBeNull()
    expect(backlogStatus('tracker:status:Done', statuses, null)).toBeNull()
  })

  it('fails when the project has no backlog status', () => {
    expect(() => backlogStatus('tracker:status:Todo', statuses, ['tracker:status:Todo'])).toThrow(/no backlog status/)
  })
})

describe('hulyPriority', () => {
  it('stores a priority as Huly’s index', () => {
    expect(['none', 'urgent', 'high', 'medium', 'low'].map((each) => hulyPriority(each as never))).toEqual([0, 1, 2, 3, 4])
  })
})

describe('personName', () => {
  it('turns the stored "Last,First" into "First Last"', () => {
    expect(personName('Doe,John')).toBe('John Doe')
    expect(personName('Doe')).toBe('Doe')
    expect(personName(' ,John ')).toBe('John')
  })
})

describe('toCard', () => {
  const ref = (_id: string) => ({ _id, _class: 'tracker:class:Issue' })
  const docs = (fields: Partial<HulyCardDocs> = {}): HulyCardDocs => ({
    issue: { ...issue('i1', 'ABC-1', 'tracker:status:Backlog'), attachedTo: 'tracker:ids:NoParent' },
    description: '',
    statuses,
    linked: [],
    blocks: [],
    milestones: [],
    labels: [],
    comments: [],
    people: new Map(),
    attachments: [],
    ...fields,
  })

  it('maps the issue with its description, priority, milestone and labels', () => {
    const card = toCard(
      docs({
        issue: { ...issue('i1', 'ABC-1', 'tracker:status:Backlog'), priority: 2, milestone: 'm1', attachedTo: 'tracker:ids:NoParent' },
        description: '# Goal',
        milestones: [{ _id: 'm1', label: 'v0.2', targetDate: 1_800_000_000_000 }],
        labels: [
          { attachedTo: 'i1', title: 'Opus' },
          { attachedTo: 'other', title: 'UI' },
        ],
      }),
    )
    expect(card).toEqual({
      id: 'ABC-1',
      title: 'Title of ABC-1',
      description: '# Goal',
      status: { name: 'Backlog', category: 'UnStarted' },
      priority: 'high',
      labels: ['Opus'],
      milestone: { label: 'v0.2', targetDate: 1_800_000_000_000 },
      parent: null,
      blockedBy: [],
      blocks: [],
      related: [],
      comments: [],
      attachments: [],
    })
  })

  it('links the parent, blockers, blocked and related issues it got', () => {
    const card = toCard(
      docs({
        issue: {
          ...issue('i1', 'ABC-1', 'tracker:status:Backlog', ['i2', 'gone']),
          attachedTo: 'i5',
          relations: [ref('i4'), { _id: 'd1', _class: 'document:class:Document' }],
        },
        linked: [issue('i2', 'ABC-2', 'tracker:status:Done'), issue('i4', 'ABC-4', 'tracker:status:Todo'), issue('i5', 'ABC-5', 'tracker:status:InProgress')],
        blocks: ['i3'],
      }),
    )
    expect(card.parent).toEqual({ id: 'ABC-5', title: 'Title of ABC-5', status: { name: 'In Progress', category: 'Active' } })
    expect(card.blockedBy).toEqual([{ id: 'ABC-2', title: 'Title of ABC-2', status: { name: 'Done', category: 'Won' } }])
    expect(card.related.map((each) => each.id)).toEqual(['ABC-4'])
    expect(card.blocks).toEqual([])
  })

  it('lists the issues it blocks from the ones fetched for that', () => {
    const card = toCard(docs({ linked: [issue('i3', 'ABC-3', 'tracker:status:Todo')], blocks: ['i3'] }))
    expect(card.blocks.map((each) => each.id)).toEqual(['ABC-3'])
  })

  it('orders the comments by time and names their authors', () => {
    const card = toCard(
      docs({
        comments: [
          { createdBy: 's2', createdOn: 20, text: 'second' },
          { createdBy: 's1', createdOn: 10, text: 'first' },
          { createdBy: 'unknown', createdOn: 30, text: 'third' },
        ],
        people: new Map([
          ['s1', 'Doe,John'],
          ['s2', 'Roe,Jane'],
        ]),
      }),
    )
    expect(card.comments).toEqual([
      { author: 'John Doe', at: 10, text: 'first' },
      { author: 'Jane Roe', at: 20, text: 'second' },
      { author: null, at: 30, text: 'third' },
    ])
  })

  it('lists the files of the issue and its comments, oldest first, to be fetched through the service', () => {
    const card = toCard(
      docs({
        attachments: [
          { file: 'b2', name: 'clip.mp4', type: 'video/mp4', size: 20, modifiedOn: 30, createdOn: 20 },
          { file: 'b1', name: 'shot.png', type: 'image/png', size: 10, modifiedOn: 10 },
          { file: 'b3', name: 'notes', modifiedOn: 40 },
        ],
      }),
    )
    expect(card.attachments).toEqual([
      { file: 'b1', name: 'shot.png', type: 'image/png', size: 10, url: null },
      { file: 'b2', name: 'clip.mp4', type: 'video/mp4', size: 20, url: null },
      { file: 'b3', name: 'notes', type: '', size: 0, url: null },
    ])
  })
})

describe('cardLinks', () => {
  it('lists the ids of the parent, blockers and related issues', () => {
    expect(
      cardLinks({
        ...issue('i1', 'ABC-1', 'tracker:status:Todo', ['i2']),
        attachedTo: 'i5',
        relations: [
          { _id: 'i4', _class: 'tracker:class:Issue' },
          { _id: 'd1', _class: 'document:class:Document' },
        ],
      }),
    ).toEqual(['i5', 'i2', 'i4'])
    expect(cardLinks({ ...issue('i1', 'ABC-1', 'tracker:status:Todo'), attachedTo: 'tracker:ids:NoParent' })).toEqual([])
  })
})

describe('vocabularyOf', () => {
  it('names the statuses of the project type in its order with their categories and the workspace labels once each', () => {
    const allowed = ['tracker:status:Todo', 'tracker:status:Backlog', 'custom-review', 'tracker:status:Done']
    expect(vocabularyOf(statuses, allowed, [{ title: 'UI' }, { title: 'Bug' }, { title: 'UI' }])).toEqual({
      statuses: [
        { name: 'Todo', category: 'ToDo' },
        { name: 'Backlog', category: 'UnStarted' },
        { name: 'In Review', category: 'Active' },
        { name: 'Done', category: 'Won' },
      ],
      labels: ['UI', 'Bug'],
    })
  })

  it('names every status when the project type is unknown', () => {
    expect(vocabularyOf(statuses, null, []).statuses.map((status) => status.name)).toEqual(statuses.map((doc) => doc.name))
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

describe('latestMessages', () => {
  it('keeps the newest message of each issue', () => {
    const messages = [
      { attachedTo: 'a', createdOn: 2, message: 'a2' },
      { attachedTo: 'b', createdOn: 1, message: 'b1' },
      { attachedTo: 'a', createdOn: 3, message: 'a3' },
      { attachedTo: 'a', createdOn: 1, message: 'a1' },
    ]
    expect(latestMessages(messages)).toEqual(new Map([['a', 'a3'], ['b', 'b1']]))
  })
})
