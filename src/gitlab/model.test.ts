import { describe, expect, it } from 'vitest'
import { issue, linked, note } from './fixture.js'
import { GITLAB_STATUSES, gitlabPriority, gitlabStatus, ProjectMap, toCard, toTrackerTask } from './model.js'

const projects = new ProjectMap({ 'project-id': { key: 'APP', value: 'group/subgroup/app' }, other: { key: 'LIB', value: 'group/lib' } }, 'https://gitlab.example.com')

describe('GitLab issue model', () => {
  it('maps the two native states and scoped or ordinary priority labels', () => {
    expect(GITLAB_STATUSES).toEqual([{ name: 'Opened', category: 'ToDo' }, { name: 'Closed', category: 'Won' }])
    expect(gitlabStatus('closed').category).toBe('Won')
    expect(gitlabPriority(['priority::low', 'PRIORITY: High', 'priority::unknown'])).toBe('high')
    expect(gitlabPriority(['bug'])).toBe('none')
  })

  it('keeps only native inbound blockers, preserving cross-project ids and milestone dates', () => {
    const task = toTrackerTask(issue(), [linked('is_blocked_by', 2), linked('blocks', 3), linked('relates_to', 4), linked('is_blocked_by', 8, 'group/lib')], projects)
    expect(task).toMatchObject({ id: 'APP-1', parent: null, subtasks: 0, blockedBy: ['APP-2', 'LIB-8'], estimate: 0, priority: 'medium', milestone: { label: 'v1.0', targetDate: Date.parse('2026-11-01') } })
    expect(toTrackerTask(issue({ description: 'blocked by #99', milestone: null }), [], projects)).toMatchObject({ blockedBy: [], milestone: null })
  })

  it('builds a card with directional links and chronological human notes', () => {
    const card = toCard(issue(), [linked('is_blocked_by', 2), linked('blocks', 3), linked('relates_to', 4, 'elsewhere/app')], [note(3), note(1), note(2, { system: true })], projects)
    expect(card).toMatchObject({ id: 'APP-1', description: 'Implement the example.', parent: null, attachments: [] })
    expect(card.blockedBy.map((ref) => ref.id)).toEqual(['APP-2'])
    expect(card.blocks.map((ref) => ref.id)).toEqual(['APP-3'])
    expect(card.related.map((ref) => ref.id)).toEqual(['elsewhere/app#4'])
    expect(card.comments.map((each) => each.text)).toEqual(['Note 1', 'Note 3'])
  })

  it('maps projects by GUID and keys without losing subgroups or confusing another host', () => {
    expect(projects.pathOf('project-id')).toBe('group/subgroup/app')
    expect(projects.pathOfKey('APP')).toBe('group/subgroup/app')
    expect(projects.idOf(issue({ web_url: 'https://elsewhere.example.com/group/subgroup/app/-/issues/1' }))).toBe('https://elsewhere.example.com/group/subgroup/app/-/issues/1')
  })
})
