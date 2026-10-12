import { describe, expect, it } from 'vitest'
import { issue } from './fixture.js'
import { linearPriority, linearStatus, readyState, toCard, toTrackerTask, type LinearCardIssue, type LinearRef, type TeamStateDoc } from './model.js'

describe('linear status', () => {
  it('takes the category from the type of the workflow state and keeps its name', () => {
    expect(linearStatus({ name: 'Triage', type: 'triage' })).toEqual({ name: 'Triage', category: 'UnStarted' })
    expect(linearStatus({ name: 'Backlog', type: 'backlog' })).toEqual({ name: 'Backlog', category: 'UnStarted' })
    expect(linearStatus({ name: 'Todo', type: 'unstarted' })).toEqual({ name: 'Todo', category: 'ToDo' })
    expect(linearStatus({ name: 'In Review', type: 'started' })).toEqual({ name: 'In Review', category: 'Active' })
    expect(linearStatus({ name: 'Done', type: 'completed' })).toEqual({ name: 'Done', category: 'Won' })
    expect(linearStatus({ name: 'Canceled', type: 'canceled' })).toEqual({ name: 'Canceled', category: 'Lost' })
    expect(linearStatus({ name: 'Duplicate', type: 'duplicate' })).toEqual({ name: 'Duplicate', category: 'Lost' })
  })

  it('keeps a state of a type it does not know out of the chain without closing it', () => {
    expect(linearStatus({ name: 'Parked', type: 'parked' })).toEqual({ name: 'Parked', category: 'UnStarted' })
  })
})

describe('linear priority', () => {
  it('maps the native levels', () => {
    expect([1, 2, 3, 4, 0].map(linearPriority)).toEqual(['urgent', 'high', 'medium', 'low', 'none'])
  })

  it('is none for a level it does not know', () => {
    expect(linearPriority(7)).toBe('none')
  })
})

describe('linear issue to task', () => {
  it('takes the fields the chain needs', () => {
    const raw = issue('ENG-7', {
      title: 'Add login',
      priority: 2,
      state: { name: 'In Progress', type: 'started' },
      labels: { nodes: [{ name: 'Sonnet' }, { name: 'Bug' }] },
      projectMilestone: { id: 'm1', name: 'v1.0', targetDate: '2026-11-01' },
    })
    expect(toTrackerTask(raw)).toEqual({
      id: 'ENG-7',
      title: 'Add login',
      status: { name: 'In Progress', category: 'Active' },
      blockedBy: [],
      parent: null,
      subtasks: 0,
      milestone: { label: 'v1.0', targetDate: Date.parse('2026-11-01') },
      priority: 'high',
      labels: ['Sonnet', 'Bug'],
      estimate: 0,
    })
  })

  it('takes blockers from the inverse blocks relations only', () => {
    const raw = issue('ENG-7', {
      inverseRelations: {
        nodes: [
          { type: 'blocks', issue: { identifier: 'ENG-3' } },
          { type: 'related', issue: { identifier: 'ENG-4' } },
          { type: 'duplicate', issue: { identifier: 'ENG-5' } },
          { type: 'blocks', issue: { identifier: 'OPS-9' } },
        ],
      },
    })
    expect(toTrackerTask(raw).blockedBy).toEqual(['ENG-3', 'OPS-9'])
  })

  it('names the parent and counts the sub-issues', () => {
    const raw = issue('ENG-7', { parent: { identifier: 'ENG-1' }, children: { nodes: [{ id: 'a' }, { id: 'b' }] } })
    expect(toTrackerTask(raw)).toMatchObject({ parent: 'ENG-1', subtasks: 2 })
  })

  it('keeps a milestone without a target date', () => {
    const raw = issue('ENG-7', { projectMilestone: { id: 'm2', name: 'Later', targetDate: null } })
    expect(toTrackerTask(raw).milestone).toEqual({ label: 'Later', targetDate: null })
  })
})

describe('linear card', () => {
  const ref = (identifier: string, type = 'unstarted'): LinearRef => ({ identifier, title: `Issue ${identifier}`, state: { name: 'S', type } })
  const raw = (fields: Partial<LinearCardIssue> = {}): LinearCardIssue => ({
    identifier: 'ENG-5',
    title: 'Issue ENG-5',
    description: 'Body',
    priority: 2,
    state: { name: 'Done', type: 'completed' },
    parent: null,
    relations: { nodes: [] },
    inverseRelations: { nodes: [] },
    labels: { nodes: [{ name: 'bug' }] },
    projectMilestone: { name: 'v1', targetDate: '2026-11-01' },
    comments: { nodes: [] },
    ...fields,
  })

  it('takes the text, labels, priority, milestone and status of the issue', () => {
    expect(toCard(raw())).toMatchObject({
      id: 'ENG-5',
      description: 'Body',
      labels: ['bug'],
      priority: 'high',
      milestone: { label: 'v1', targetDate: Date.parse('2026-11-01') },
      status: { name: 'Done', category: 'Won' },
      parent: null,
      attachments: [],
    })
    expect(toCard(raw({ description: null, projectMilestone: null })).description).toBe('')
  })

  it('reads blocks both ways and related from either side', () => {
    const card = toCard(
      raw({
        parent: ref('ENG-1', 'started'),
        relations: { nodes: [{ type: 'blocks', relatedIssue: ref('ENG-3') }, { type: 'related', relatedIssue: ref('ENG-4') }, { type: 'duplicate', relatedIssue: ref('ENG-9') }] },
        inverseRelations: {
          nodes: [{ type: 'blocks', issue: ref('ENG-2', 'completed') }, { type: 'related', issue: ref('ENG-4') }, { type: 'related', issue: ref('ENG-6') }],
        },
      }),
    )
    expect(card.parent).toEqual({ id: 'ENG-1', title: 'Issue ENG-1', status: { name: 'S', category: 'Active' } })
    expect(card.blockedBy.map((each) => each.id)).toEqual(['ENG-2'])
    expect(card.blockedBy[0]!.status.category).toBe('Won')
    expect(card.blocks.map((each) => each.id)).toEqual(['ENG-3'])
    expect(card.related.map((each) => each.id)).toEqual(['ENG-4', 'ENG-6'])
  })

  it('orders comments by time and leaves the author empty for a removed user', () => {
    const card = toCard(
      raw({
        comments: {
          nodes: [
            { user: null, createdAt: '2026-10-02T10:00:00Z', body: 'second' },
            { user: { name: 'Jane Roe' }, createdAt: '2026-10-01T10:00:00Z', body: 'first' },
          ],
        },
      }),
    )
    expect(card.comments).toEqual([
      { author: 'Jane Roe', at: Date.parse('2026-10-01T10:00:00Z'), text: 'first' },
      { author: null, at: Date.parse('2026-10-02T10:00:00Z'), text: 'second' },
    ])
  })
})

describe('linear ready state', () => {
  const states: TeamStateDoc[] = [
    { id: 'a', name: 'Backlog', type: 'backlog', position: 0 },
    { id: 'c', name: 'Selected', type: 'unstarted', position: 2 },
    { id: 'b', name: 'Todo', type: 'unstarted', position: 1 },
    { id: 'd', name: 'Done', type: 'completed', position: 3 },
  ]

  it('moves a backlog task to the first unstarted state by position', () => {
    expect(readyState({ name: 'Backlog', type: 'backlog' }, states)?.id).toBe('b')
  })

  it('leaves a task that is not in the backlog alone', () => {
    expect(readyState({ name: 'Todo', type: 'unstarted' }, states)).toBeNull()
    expect(readyState({ name: 'Triage', type: 'triage' }, states)).toBeNull()
  })

  it('fails for a team without an unstarted state', () => {
    expect(() => readyState({ name: 'Backlog', type: 'backlog' }, [states[0]!])).toThrow(/unstarted/)
  })
})
