import { describe, expect, it } from 'vitest'
import { RepoMap } from '../github/model.js'
import { comment, issue } from './fixture.js'
import { forgejoPriority, forgejoStatus, toCard, toTrackerTask } from './model.js'

const repos = new RepoMap({ 'id-app': { key: 'APP', value: 'example-org/app' } })

describe('forgejo model', () => {
  it('takes an open issue for ready and a closed one for done, never for lost', () => {
    expect(forgejoStatus('open')).toEqual({ name: 'Open', category: 'ToDo' })
    expect(forgejoStatus('closed')).toEqual({ name: 'Closed', category: 'Won' })
  })

  it('reads the priority of a label in any of the three spellings, the highest of several', () => {
    expect(forgejoPriority(['priority: high'])).toBe('high')
    expect(forgejoPriority(['priority/Low'])).toBe('low')
    expect(forgejoPriority(['priority::urgent', 'priority/low'])).toBe('urgent')
    expect(forgejoPriority(['bug', 'priority', 'priority: someday', 'priority/none'])).toBe('none')
  })

  it('names an issue of a project by its key and one of another repository by its address', () => {
    const task = toTrackerTask(issue({ number: 7 }), [issue({ number: 3 }), issue({ number: 4, repository: { owner: 'other', name: 'lib', full_name: 'other/lib' } })], repos)
    expect(task).toEqual({
      id: 'APP-7', title: 'Example issue', status: { name: 'Open', category: 'ToDo' }, blockedBy: ['APP-3', 'other/lib#4'], parent: null, subtasks: 0,
      milestone: { label: 'v1.0', targetDate: Date.parse('2026-11-01T00:00:00Z') }, priority: 'medium', labels: ['priority/medium'], estimate: 0,
    })
    expect(toTrackerTask(issue({ labels: null, milestone: null }), [], repos)).toMatchObject({ labels: [], milestone: null, priority: 'none' })
  })

  it('makes a card with both directions of the dependencies and the comments in time order', () => {
    const card = toCard(issue({ body: null }), [issue({ number: 2, state: 'closed', title: 'Blocker' })], [issue({ number: 9, title: 'Waits' })], [comment(3, { user: null }), comment(1)], repos)
    expect(card).toMatchObject({
      id: 'APP-1', description: '', parent: null, related: [], attachments: [],
      blockedBy: [{ id: 'APP-2', title: 'Blocker', status: { category: 'Won' } }],
      blocks: [{ id: 'APP-9', title: 'Waits', status: { category: 'ToDo' } }],
    })
    expect(card.comments).toEqual([
      { author: 'john-doe', at: Date.parse('2026-10-01T00:00:01Z'), text: 'Comment 1' },
      { author: null, at: Date.parse('2026-10-01T00:00:03Z'), text: 'Comment 3' },
    ])
  })
})
