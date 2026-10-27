import { describe, expect, it } from 'vitest'
import { BACKLOG, blockedBy, DONE, issue, PROGRESS, ref, TODO } from './fixture.js'
import { earliestVersion, jiraPriority, jiraStatus, priorityFor, toCard, toTrackerTask } from './model.js'

const ORDER = ['Highest', 'High', 'Medium', 'Low', 'Lowest']

describe('jiraStatus', () => {
  it('recognizes the untranslated backlog name while keeping the localized display name', () => {
    expect(jiraStatus({ ...BACKLOG, name: 'Бэклог', untranslatedName: 'Backlog' })).toEqual({ name: 'Бэклог', category: 'UnStarted' })
    expect(jiraStatus({ ...TODO, name: 'Backlog', untranslatedName: 'To Do' })).toEqual({ name: 'Backlog', category: 'ToDo' })
    expect(jiraStatus({ name: 'Backlog', statusCategory: { key: 'new' } })).toEqual({ name: 'Backlog', category: 'UnStarted' })
    expect(jiraStatus({ name: 'Backlog', untranslatedName: null, statusCategory: { key: 'new' } })).toEqual({ name: 'Backlog', category: 'UnStarted' })
  })

  it('goes by the status category, and a new status named Backlog is the backlog', () => {
    expect(jiraStatus(TODO)).toEqual({ name: 'To Do', category: 'ToDo' })
    expect(jiraStatus(BACKLOG)).toEqual({ name: 'Backlog', category: 'UnStarted' })
    expect(jiraStatus(PROGRESS)).toEqual({ name: 'In Progress', category: 'Active' })
    expect(jiraStatus({ name: 'In Review', statusCategory: { key: 'indeterminate' } })).toEqual({ name: 'In Review', category: 'Active' })
    expect(jiraStatus(DONE)).toEqual({ name: 'Done', category: 'Won' })
    expect(jiraStatus({ name: 'Odd', statusCategory: { key: 'undefined' } })).toEqual({ name: 'Odd', category: 'UnStarted' })
  })
})

describe('jiraPriority', () => {
  it('maps the built-in priorities by name', () => {
    expect(['Highest', 'High', 'Medium', 'Low', 'Lowest'].map((name) => jiraPriority({ name }, ORDER))).toEqual(['urgent', 'high', 'medium', 'low', 'low'])
    expect(jiraPriority(null, ORDER)).toBe('none')
  })

  it('maps a scheme of its own by place, highest first', () => {
    const own = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6']
    expect(own.map((name) => jiraPriority({ name }, own))).toEqual(['urgent', 'high', 'high', 'medium', 'medium', 'low', 'low'])
    expect(jiraPriority({ name: 'Only' }, ['Only'])).toBe('medium')
    expect(jiraPriority({ name: 'Unknown' }, own)).toBe('none')
  })

  it('picks the site priority for a level: the built-in name first, else by place', () => {
    const built = ORDER.map((name, index) => ({ id: String(index + 1), name }))
    expect(priorityFor('urgent', built)?.name).toBe('Highest')
    expect(priorityFor('low', built)?.name).toBe('Low')
    expect(priorityFor('none', built)).toBeUndefined()
    const own = ['Critical', 'Normal', 'Minor'].map((name, index) => ({ id: String(index), name }))
    expect(['urgent', 'high', 'medium', 'low'].map((level) => priorityFor(level as 'urgent', own)?.name)).toEqual(['Critical', undefined, 'Normal', 'Minor'])
  })
})

describe('earliestVersion', () => {
  it('takes the earliest release date, a version without one last', () => {
    const versions = [{ id: '3', name: 'later' }, { id: '2', name: 'v1.1', releaseDate: '2026-12-01' }, { id: '1', name: 'v1.0', releaseDate: '2026-11-01' }]
    expect(earliestVersion(versions)?.name).toBe('v1.0')
    expect(earliestVersion([{ id: '3', name: 'later' }])?.name).toBe('later')
    expect(earliestVersion([])).toBeNull()
  })
})

describe('toTrackerTask', () => {
  it('reads blockers from inward Blocks links only, the parent, the sub-tasks and the milestone', () => {
    const task = toTrackerTask(
      issue('ABC-5', {
        issuelinks: [blockedBy('ABC-1'), { type: { name: 'Blocks' }, outwardIssue: ref('ABC-9') }, { type: { name: 'Relates' }, inwardIssue: ref('ABC-2') }],
        parent: ref('ABC-3'),
        subtasks: [{ key: 'ABC-6' }],
        fixVersions: [{ id: '20', name: 'v1.0', releaseDate: '2026-11-01' }],
        labels: ['Claude | opus'],
        priority: { id: '2', name: 'High' },
      }),
      ORDER,
    )
    expect(task).toEqual({
      id: 'ABC-5',
      title: 'Issue ABC-5',
      status: { name: 'To Do', category: 'ToDo' },
      blockedBy: ['ABC-1'],
      parent: 'ABC-3',
      subtasks: 1,
      milestone: { label: 'v1.0', targetDate: Date.parse('2026-11-01') },
      priority: 'high',
      labels: ['Claude | opus'],
      estimate: 0,
    })
    expect(toTrackerTask(issue('ABC-7'), ORDER, 4).subtasks).toBe(4)
  })
})

describe('toCard', () => {
  it('turns the description and comments into Markdown with the files through the service, and sorts links by kind', () => {
    const card = toCard(
      issue('ABC-5', {
        description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See' }] }, { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'm-1', alt: 'screen.png' } }] }] },
        attachment: [{ id: '10100', filename: 'screen.png', mimeType: 'image/png', size: 2048 }],
        issuelinks: [blockedBy('ABC-1'), { type: { name: 'Blocks' }, outwardIssue: ref('ABC-9', DONE) }, { type: { name: 'Relates' }, outwardIssue: ref('ABC-2') }, { type: { name: 'Duplicate' }, inwardIssue: ref('ABC-4') }],
        parent: ref('ABC-3', PROGRESS),
      }),
      [
        { id: '2', author: null, created: '2026-10-02T10:00:00.000+0000', body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] } },
        { id: '1', author: { displayName: 'John Doe' }, created: '2026-10-01T10:00:00.000+0000', body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first', marks: [{ type: 'strong' }] }] }] } },
      ],
      ORDER,
    )
    expect(card.description).toBe('See\n\n![screen.png](/api/tasks/ABC-5/files/10100)')
    expect(card.attachments).toEqual([{ file: '10100', name: 'screen.png', type: 'image/png', size: 2048, url: null }])
    expect(card.parent).toEqual({ id: 'ABC-3', title: 'Issue ABC-3', status: { name: 'In Progress', category: 'Active' } })
    expect(card.blockedBy.map((each) => each.id)).toEqual(['ABC-1'])
    expect(card.blocks).toEqual([{ id: 'ABC-9', title: 'Issue ABC-9', status: { name: 'Done', category: 'Won' } }])
    expect(card.related.map((each) => each.id)).toEqual(['ABC-2'])
    expect(card.comments).toEqual([
      { author: 'John Doe', at: Date.parse('2026-10-01T10:00:00.000Z'), text: '**first**' },
      { author: null, at: Date.parse('2026-10-02T10:00:00.000Z'), text: 'second' },
    ])
  })
})
