import { describe, expect, it } from 'vitest'
import type { TaskStatus } from '../tracker/model.js'
import { issue } from './fixture.js'
import { connectGithub } from './source.js'

interface Call {
  query: string
  variables: Record<string, unknown>
}

type Reply = { status?: number; body: unknown }

function fakeFetch(replies: Reply[]) {
  const calls: Call[] = []
  const fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push(JSON.parse(String(init?.body)) as Call)
    const reply = replies.shift()
    if (reply === undefined) throw new Error(`unexpected call: ${calls.at(-1)!.query}`)
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls }
}

const VIEWER: Reply = { body: { data: { viewer: { login: 'octocat' } } } }
const page = (nodes: unknown[], endCursor: string | null = null) => ({
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
  nodes,
})
const notFound = (path: string[]) => ({ type: 'NOT_FOUND', path, message: 'Could not resolve to an Issue with the number of 99.' })

const PROJECTS = { ABC: 'octo-org/abc' }
const notTerminal = (status: TaskStatus) => status.category !== 'Won' && status.category !== 'Lost'

async function connect(replies: Reply[]) {
  const fake = fakeFetch([VIEWER, ...replies])
  const source = await connectGithub({ token: 'github_pat_example', projects: PROJECTS }, 5_000, fake.fetch)
  return { source, calls: fake.calls }
}

describe('github source', () => {
  it('checks the token on connect and refuses a bad one', async () => {
    const fake = fakeFetch([{ status: 401, body: { message: 'Bad credentials' } }])
    await expect(connectGithub({ token: 'bad', projects: PROJECTS }, 5_000, fake.fetch)).rejects.toThrow(/401.*Bad credentials/)
  })

  it('reads the open issues of the repository page by page', async () => {
    const { source, calls } = await connect([
      { body: { data: { repository: { issues: page([issue(1)], 'cursor-1') } } } },
      { body: { data: { repository: { issues: page([issue(2, { blockedBy: { nodes: [{ number: 1, repository: { nameWithOwner: 'octo-org/abc' } }] } })]) } } } },
    ])
    const { tasks, statuses } = await source.chainTasks('ABC', notTerminal)
    expect(tasks.map((task) => [task.id, task.blockedBy])).toEqual([
      ['ABC-1', []],
      ['ABC-2', ['ABC-1']],
    ])
    expect(statuses).toEqual(['Open', 'Completed', 'Not planned', 'Duplicate'])
    expect(calls[1]!.variables).toMatchObject({ owner: 'octo-org', name: 'abc', states: ['OPEN'], after: null })
    expect(calls[2]!.variables).toMatchObject({ after: 'cursor-1' })
  })

  it('adds the closed issues of the milestones its open leaf issues are in', async () => {
    const v1 = { number: 4, title: 'v1.0', dueOn: null }
    const { source, calls } = await connect([
      { body: { data: { repository: { issues: page([issue(1, { milestone: v1 }), issue(2, { subIssuesSummary: { total: 2 }, milestone: { ...v1, number: 5 } })]) } } } },
      { body: { data: { repository: { milestone: { issues: page([issue(3, { state: 'CLOSED', stateReason: 'COMPLETED', milestone: v1 })]) } } } } },
    ])
    const { tasks } = await source.chainTasks('ABC', notTerminal)
    expect(tasks.map((task) => [task.id, task.status.category])).toEqual([
      ['ABC-1', 'ToDo'],
      ['ABC-2', 'ToDo'],
      ['ABC-3', 'Won'],
    ])
    expect(calls[2]!.variables).toMatchObject({ number: 4, states: ['CLOSED'] })
  })

  it('fails on a project without a repository and on a repository it cannot see', async () => {
    const { source } = await connect([{ body: { data: { repository: null }, errors: [{ type: 'NOT_FOUND', path: ['repository'], message: 'Could not resolve to a Repository' }] } }])
    await expect(source.chainTasks('XYZ', notTerminal)).rejects.toThrow(/XYZ/)
    await expect(source.chainTasks('ABC', notTerminal)).rejects.toThrow(/octo-org\/abc/)
  })

  it('reads tasks by id, leaving out what is gone or not its own', async () => {
    const { source, calls } = await connect([
      {
        body: {
          data: { r0: { i12: issue(12, { state: 'CLOSED', stateReason: 'NOT_PLANNED' }), i99: null } },
          errors: [notFound(['r0', 'i99'])],
        },
      },
    ])
    const tasks = await source.tasks(['ABC-12', 'ABC-99', 'XYZ-1', 'junk'])
    expect(tasks.map((task) => [task.id, task.status.name])).toEqual([['ABC-12', 'Not planned']])
    expect(calls[1]!.query).toContain('r0: repository(owner: "octo-org", name: "abc")')
    expect(calls[1]!.query).toContain('i12: issue(number: 12)')
  })

  it('asks nothing for an empty list', async () => {
    const { source, calls } = await connect([])
    expect(await source.tasks(['XYZ-1'])).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('fails on any error but a missing issue', async () => {
    const { source } = await connect([{ body: { data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] } }])
    await expect(source.tasks(['ABC-1'])).rejects.toThrow(/rate limit/)
  })

  it('gives the title and the body as the brief', async () => {
    const { source } = await connect([
      { body: { data: { repository: { issue: { title: 'Add login', body: 'Use **OAuth**.' } } } } },
      { body: { data: { repository: { issue: null } }, errors: [notFound(['repository', 'issue'])] } },
    ])
    expect(await source.brief!('ABC-7')).toEqual({ title: 'Add login', description: 'Use **OAuth**.' })
    await expect(source.brief!('ABC-8')).rejects.toThrow(/ABC-8/)
  })

  it('closes an open issue as completed', async () => {
    const { source, calls } = await connect([
      { body: { data: { repository: { issue: { id: 'I_kwDOexample7', state: 'OPEN' } } } } },
      { body: { data: { closeIssue: { issue: { state: 'CLOSED' } } } } },
    ])
    expect(await source.complete!('ABC-7')).toBe(true)
    expect(calls[2]!.query).toContain('closeIssue')
    expect(calls[2]!.variables).toEqual({ id: 'I_kwDOexample7' })
    expect(calls[2]!.query).toContain('stateReason: COMPLETED')
  })

  it('leaves a closed issue alone', async () => {
    const { source, calls } = await connect([{ body: { data: { repository: { issue: { id: 'I_kwDOexample7', state: 'CLOSED' } } } } }])
    expect(await source.complete!('ABC-7')).toBe(false)
    expect(calls).toHaveLength(2)
  })

  it('posts a comment on the issue and gives its id', async () => {
    const { source, calls } = await connect([
      { body: { data: { repository: { issue: { id: 'I_kwDOexample7', state: 'OPEN' } } } } },
      { body: { data: { addComment: { commentEdge: { node: { id: 'IC_1' } } } } } },
    ])
    expect(await source.comment!('ABC-7', 'Which one?')).toBe('IC_1')
    expect(calls[2]!.variables).toEqual({ id: 'I_kwDOexample7', body: 'Which one?' })
  })

  it('creates an open issue with the priority label in the milestone of the given task', async () => {
    const { source, calls } = await connect([
      { body: { data: { repository: { id: 'R_1', label: { id: 'LA_high' }, issue: { milestone: { id: 'MI_1' } } } } } },
      { body: { data: { createIssue: { issue: { number: 42 } } } } },
    ])
    const id = await source.create!({ project: 'ABC', title: 'CI on main failed: abcdef1', description: 'Log', priority: 'high', milestoneOf: 'ABC-7' })
    expect(id).toBe('ABC-42')
    expect(calls[1]!.variables).toEqual({ owner: 'octo-org', name: 'abc', label: 'priority: high', number: 7, withIssue: true })
    expect(calls[2]!.variables).toEqual({ input: { repositoryId: 'R_1', title: 'CI on main failed: abcdef1', body: 'Log', labelIds: ['LA_high'], milestoneId: 'MI_1' } })
  })

  it('creates an issue without a label or a milestone the repository does not have', async () => {
    const { source, calls } = await connect([
      { body: { data: { repository: { id: 'R_1', label: null } } } },
      { body: { data: { createIssue: { issue: { number: 43 } } } } },
    ])
    expect(await source.create!({ project: 'ABC', title: 'T', description: 'D', priority: 'high', milestoneOf: null })).toBe('ABC-43')
    expect(calls[1]!.variables).toMatchObject({ number: 0, withIssue: false })
    expect(calls[2]!.variables).toEqual({ input: { repositoryId: 'R_1', title: 'T', body: 'D' } })
  })

  it('puts an issue without a milestone into the milestone of another issue', async () => {
    const { source, calls } = await connect([
      { body: { data: { repository: { issue: { id: 'I_kwDOexample9', milestone: null }, like: { milestone: { id: 'MI_1' } } } } } },
      { body: { data: { updateIssue: { issue: { number: 9 } } } } },
    ])
    expect(await source.setMilestone!('ABC-9', 'ABC-7')).toBe(true)
    expect(calls[1]!.variables).toEqual({ owner: 'octo-org', name: 'abc', number: 9, like: 7 })
    expect(calls[2]!.variables).toEqual({ id: 'I_kwDOexample9', milestone: 'MI_1' })
  })

  it('leaves alone an issue that has a milestone, and one whose model has none or is in another repository', async () => {
    const { source, calls } = await connect([
      { body: { data: { repository: { issue: { id: 'I_kwDOexample9', milestone: { id: 'MI_2' } }, like: { milestone: { id: 'MI_1' } } } } } },
      { body: { data: { repository: { issue: { id: 'I_kwDOexample9', milestone: null }, like: { milestone: null } } } } },
    ])
    expect(await source.setMilestone!('ABC-9', 'ABC-7')).toBe(false)
    expect(await source.setMilestone!('ABC-9', 'ABC-7')).toBe(false)
    expect(await source.setMilestone!('ABC-9', 'XYZ-7')).toBe(false)
    expect(calls).toHaveLength(3)
  })

  it('offers the open milestones of the repository and the closed one the issue is in', async () => {
    const nodes = [{ id: 'MI_1', title: 'v0.1', dueOn: '2026-10-21T00:00:00Z' }, { id: 'MI_2', title: 'v0.2', dueOn: null }]
    const { source, calls } = await connect([
      { body: { data: { repository: { issue: { milestone: { id: 'MI_0', title: 'v0.0', dueOn: null, closed: true } }, milestones: { nodes } } } } },
      { body: { data: { repository: { issue: { milestone: { id: 'MI_2', title: 'v0.2', dueOn: null, closed: false } }, milestones: { nodes } } } } },
    ])
    expect(await source.milestones!('ABC-9')).toEqual({
      current: 'MI_0',
      choices: [
        { id: 'MI_1', label: 'v0.1', targetDate: Date.parse('2026-10-21T00:00:00Z') },
        { id: 'MI_2', label: 'v0.2', targetDate: null },
        { id: 'MI_0', label: 'v0.0', targetDate: null },
      ],
    })
    expect(calls[1]!.variables).toEqual({ owner: 'octo-org', name: 'abc', number: 9 })
    expect((await source.milestones!('ABC-9')).choices.map((choice) => choice.id)).toEqual(['MI_1', 'MI_2'])
  })

  it('moves an issue into a milestone or out of any', async () => {
    const state = { body: { data: { repository: { issue: { id: 'I_kwDOexample9', state: 'OPEN' } } } } }
    const done = { body: { data: { updateIssue: { issue: { number: 9 } } } } }
    const { source, calls } = await connect([state, done, state, done])
    await source.moveMilestone!('ABC-9', 'MI_2')
    expect(calls[2]!.variables).toEqual({ id: 'I_kwDOexample9', milestone: 'MI_2' })
    await source.moveMilestone!('ABC-9', null)
    expect(calls[4]!.variables).toEqual({ id: 'I_kwDOexample9', milestone: null })
  })

  it('gives the comments after a given one with the files they link to', async () => {
    const nodes = [
      { id: 'IC_0', body: 'earlier' },
      { id: 'IC_1', body: 'Which one?' },
      { id: 'IC_2', body: '2\n![shot](https://github.com/user-attachments/assets/abc-123)' },
    ]
    const { source } = await connect([{ body: { data: { repository: { issue: { comments: { nodes } } } } } }])
    expect(await source.commentsAfter!('ABC-7', 'IC_1')).toEqual([
      { id: 'IC_2', body: nodes[2]!.body, files: [{ name: 'shot', file: 'https://github.com/user-attachments/assets/abc-123' }] },
    ])
  })

  it('serves no file from outside the upload hosts', async () => {
    const { source } = await connect([])
    expect(await source.file!('ABC-7', 'https://example.com/steal')).toBeNull()
  })

  it('names its own statuses and every label of the repository, page by page', async () => {
    const { source, calls } = await connect([
      { body: { data: { repository: { labels: page([{ name: 'bug' }, { name: 'priority: high' }], 'cursor-1') } } } },
      { body: { data: { repository: { labels: page([{ name: 'Question' }]) } } } },
    ])
    expect(await source.vocabulary!('ABC')).toEqual({
      statuses: ['Open', 'Completed', 'Not planned', 'Duplicate'],
      labels: ['bug', 'priority: high', 'Question'],
    })
    expect(calls[1]!.variables).toMatchObject({ owner: 'octo-org', name: 'abc', after: null })
    expect(calls[2]!.variables).toMatchObject({ after: 'cursor-1' })
  })

  it('fails the vocabulary of a repository the token cannot see', async () => {
    const { source } = await connect([{ body: { data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] } }])
    await expect(source.vocabulary!('ABC')).rejects.toThrow(/octo-org\/abc not found/)
  })
})
