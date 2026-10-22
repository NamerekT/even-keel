import { describe, expect, it } from 'vitest'
import { githubPriority, githubStatus, RepoMap, toCard, toTrackerTask, type CardRef, type GithubCardIssue, type GithubIssue } from './model.js'
import { issue } from './fixture.js'

const repos = new RepoMap({ 'id-abc': { key: 'ABC', value: 'octo-org/abc' }, 'id-xyz': { key: 'XYZ', value: 'Octo-Org/xyz' } })

describe('github status', () => {
  it('maps an open issue to ToDo and a closed one by its reason', () => {
    expect(githubStatus('OPEN', null)).toEqual({ name: 'Open', category: 'ToDo' })
    expect(githubStatus('OPEN', 'REOPENED')).toEqual({ name: 'Open', category: 'ToDo' })
    expect(githubStatus('CLOSED', 'COMPLETED')).toEqual({ name: 'Completed', category: 'Won' })
    expect(githubStatus('CLOSED', 'NOT_PLANNED')).toEqual({ name: 'Not planned', category: 'Lost' })
    expect(githubStatus('CLOSED', 'DUPLICATE')).toEqual({ name: 'Duplicate', category: 'Lost' })
  })

  it('counts an issue closed before GitHub had reasons as completed', () => {
    expect(githubStatus('CLOSED', null)).toEqual({ name: 'Completed', category: 'Won' })
  })
})

describe('github priority', () => {
  it('reads it from a priority label', () => {
    expect(githubPriority(['bug', 'priority: high'])).toBe('high')
    expect(githubPriority(['Priority:Urgent'])).toBe('urgent')
    expect(githubPriority(['priority/low'])).toBe('low')
    expect(githubPriority([' priority : medium '])).toBe('medium')
  })

  it('is none without a priority label or with a level it does not know', () => {
    expect(githubPriority(['bug'])).toBe('none')
    expect(githubPriority(['priority: someday'])).toBe('none')
  })

  it('takes the most urgent of several', () => {
    expect(githubPriority(['priority: low', 'priority: high'])).toBe('high')
  })
})

describe('github repositories', () => {
  it('finds the project of a repository whatever the case', () => {
    expect(repos.keyOf('octo-org/xyz')).toBe('XYZ')
    expect(repos.keyOf('OCTO-ORG/ABC')).toBe('ABC')
    expect(repos.keyOf('someone/else')).toBeUndefined()
    expect(repos.repoOf('id-abc')).toEqual({ owner: 'octo-org', name: 'abc' })
    expect(repos.repoOfKey('ABC')).toEqual({ owner: 'octo-org', name: 'abc' })
    expect(repos.projectKey('id-abc')).toBe('ABC')
    expect(repos.repoOf('NOPE')).toBeUndefined()
  })
})

describe('github issue to task', () => {
  it('takes the fields the chain needs', () => {
    const raw: GithubIssue = issue(7, {
      title: 'Add login',
      labels: { nodes: [{ name: 'Sonnet' }, { name: 'priority: high' }] },
      milestone: { number: 2, title: 'v1.0', dueOn: '2026-11-01T00:00:00Z' },
    })
    expect(toTrackerTask(raw, repos)).toEqual({
      id: 'ABC-7',
      title: 'Add login',
      status: { name: 'Open', category: 'ToDo' },
      blockedBy: [],
      parent: null,
      subtasks: 0,
      milestone: { label: 'v1.0', targetDate: Date.parse('2026-11-01T00:00:00Z') },
      priority: 'high',
      labels: ['Sonnet', 'priority: high'],
      estimate: 0,
    })
  })

  it('names blockers and the parent by the project of their repository', () => {
    const raw = issue(7, {
      blockedBy: { nodes: [{ number: 3, repository: { nameWithOwner: 'octo-org/abc' } }, { number: 9, repository: { nameWithOwner: 'octo-org/xyz' } }] },
      parent: { number: 1, repository: { nameWithOwner: 'octo-org/abc' } },
    })
    expect(toTrackerTask(raw, repos)).toMatchObject({ blockedBy: ['ABC-3', 'XYZ-9'], parent: 'ABC-1' })
  })

  it('names an issue of a repository no project has by the repository itself', () => {
    const raw = issue(7, {
      blockedBy: { nodes: [{ number: 4, repository: { nameWithOwner: 'someone/else' } }] },
      parent: { number: 2, repository: { nameWithOwner: 'someone/else' } },
    })
    expect(toTrackerTask(raw, repos)).toMatchObject({ blockedBy: ['someone/else#4'], parent: 'someone/else#2' })
  })

  it('counts sub-issues and keeps a milestone without a due date', () => {
    const raw = issue(7, { subIssuesSummary: { total: 3 }, milestone: { number: 1, title: 'Later', dueOn: null } })
    expect(toTrackerTask(raw, repos)).toMatchObject({ subtasks: 3, milestone: { label: 'Later', targetDate: null } })
  })

  it('takes the status from the state and its reason', () => {
    expect(toTrackerTask(issue(7, { state: 'CLOSED', stateReason: 'NOT_PLANNED' }), repos).status).toEqual({ name: 'Not planned', category: 'Lost' })
  })
})

describe('github card', () => {
  const ref = (number: number, fields: Partial<CardRef> = {}, repo = 'octo-org/abc'): CardRef => ({
    number,
    title: `Issue ${number}`,
    state: 'OPEN',
    stateReason: null,
    repository: { nameWithOwner: repo },
    ...fields,
  })
  const raw = (fields: Partial<GithubCardIssue> = {}): GithubCardIssue => ({
    ...issue(5),
    body: 'Body',
    parent: null,
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
    comments: { nodes: [] },
    ...fields,
  })

  it('takes the text, labels, priority, milestone and status of the issue', () => {
    const card = toCard(
      raw({ labels: { nodes: [{ name: 'bug' }, { name: 'priority: high' }] }, milestone: { number: 1, title: 'v1', dueOn: '2026-11-01T00:00:00Z' }, state: 'CLOSED', stateReason: 'COMPLETED' }),
      repos,
    )
    expect(card).toMatchObject({
      id: 'ABC-5',
      description: 'Body',
      labels: ['bug', 'priority: high'],
      priority: 'high',
      milestone: { label: 'v1', targetDate: Date.parse('2026-11-01T00:00:00Z') },
      status: { name: 'Completed', category: 'Won' },
      related: [],
      attachments: [],
    })
  })

  it('has an empty description for an issue without a body', () => {
    expect(toCard(raw({ body: null }), repos).description).toBe('')
  })

  it('names the parent, the blockers and the issues it blocks by project key, with their status', () => {
    const card = toCard(
      raw({
        parent: ref(1),
        blockedBy: { nodes: [ref(2, { state: 'CLOSED', stateReason: 'COMPLETED' })] },
        blocking: { nodes: [ref(3, {}, 'Octo-Org/xyz'), ref(4, {}, 'other/repo')] },
      }),
      repos,
    )
    expect(card.parent).toEqual({ id: 'ABC-1', title: 'Issue 1', status: { name: 'Open', category: 'ToDo' } })
    expect(card.blockedBy).toEqual([{ id: 'ABC-2', title: 'Issue 2', status: { name: 'Completed', category: 'Won' } }])
    expect(card.blocks.map((each) => each.id)).toEqual(['XYZ-3', 'other/repo#4'])
  })

  it('orders comments by time and leaves the author empty for a deleted account', () => {
    const card = toCard(
      raw({
        comments: {
          nodes: [
            { author: null, createdAt: '2026-10-02T10:00:00Z', body: 'second' },
            { author: { login: 'octocat' }, createdAt: '2026-10-01T10:00:00Z', body: 'first' },
          ],
        },
      }),
      repos,
    )
    expect(card.comments).toEqual([
      { author: 'octocat', at: Date.parse('2026-10-01T10:00:00Z'), text: 'first' },
      { author: null, at: Date.parse('2026-10-02T10:00:00Z'), text: 'second' },
    ])
  })
})
