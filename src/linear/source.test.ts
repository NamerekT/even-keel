import { describe, expect, it } from 'vitest'
import type { TaskStatus } from '../tracker/model.js'
import { issue } from './fixture.js'
import { connectLinear } from './source.js'

interface Call {
  query: string
  variables: Record<string, unknown>
}

type Reply = { status?: number; body: unknown }

function fakeFetch(replies: Reply[]) {
  const calls: Call[] = []
  const headers: Headers[] = []
  const fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push(JSON.parse(String(init?.body)) as Call)
    headers.push(new Headers(init?.headers))
    const reply = replies.shift()
    if (reply === undefined) throw new Error(`unexpected call: ${calls.at(-1)!.query}`)
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls, headers }
}

const ORGANIZATION: Reply = { body: { data: { organization: { urlKey: 'example-org' } } } }
const page = (nodes: unknown[], endCursor: string | null = null) => ({
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
  nodes,
})
const STATES = [
  { id: 's-backlog', name: 'Backlog', type: 'backlog' },
  { id: 's-todo', name: 'Todo', type: 'unstarted' },
  { id: 's-doing', name: 'In Progress', type: 'started' },
  { id: 's-done', name: 'Done', type: 'completed' },
  { id: 's-canceled', name: 'Canceled', type: 'canceled' },
]
const team = (projects?: { id: string; url?: string }[]) => ({
  body: { data: { team: { id: 'team-eng', states: { nodes: STATES }, ...(projects === undefined ? {} : { projects: { nodes: projects } }) } } },
})
const notFound = (what: string) => ({
  status: 400,
  body: { data: null, errors: [{ message: `Entity not found: ${what}`, extensions: { code: 'INPUT_ERROR' } }] },
})

const notTerminal = (status: TaskStatus) => status.category !== 'Won' && status.category !== 'Lost'

async function connect(replies: Reply[], projects: Record<string, string> = {}) {
  const fake = fakeFetch([ORGANIZATION, ...replies])
  const source = await connectLinear({ token: 'lin_api_example', projects }, 5_000, fake.fetch)
  return { source, ...fake }
}

describe('linear source', () => {
  it('learns the workspace on connect and sends the key as it is', async () => {
    const { source, headers } = await connect([])
    expect(source.urlKey).toBe('example-org')
    expect(headers[0]!.get('authorization')).toBe('lin_api_example')
  })

  it('refuses a bad key', async () => {
    const fake = fakeFetch([{ status: 401, body: { errors: [{ message: 'Authentication required, not authenticated' }] } }])
    await expect(connectLinear({ token: 'bad', projects: {} }, 5_000, fake.fetch)).rejects.toThrow(/401.*Authentication required/)
  })

  it('reads the open issues of the team page by page, by the open states of its workflow', async () => {
    const { source, calls } = await connect([
      team(),
      { body: { data: { issues: page([issue('ENG-1')], 'cursor-1') } } },
      { body: { data: { issues: page([issue('ENG-2', { inverseRelations: { nodes: [{ type: 'blocks', issue: { identifier: 'ENG-1' } }] } })]) } } },
    ])
    const { tasks, statuses } = await source.chainTasks('ENG', notTerminal)
    expect(tasks.map((task) => [task.id, task.blockedBy])).toEqual([
      ['ENG-1', []],
      ['ENG-2', ['ENG-1']],
    ])
    expect(statuses).toEqual(['Backlog', 'Todo', 'In Progress', 'Done', 'Canceled'])
    expect(calls[1]!.variables).toEqual({ team: 'ENG' })
    expect(calls[2]!.variables).toEqual({ filter: { team: { id: { eq: 'team-eng' } }, state: { id: { in: ['s-backlog', 's-todo', 's-doing'] } } }, after: null })
    expect(calls[3]!.variables).toMatchObject({ after: 'cursor-1' })
  })

  it('narrows the team down to the project named in the config and learns its page', async () => {
    const url = 'https://linear.app/example-org/project/web-app-0123456789ab'
    const { source, calls } = await connect([team([{ id: 'project-web', url }]), { body: { data: { issues: page([]) } } }], { ENG: 'Web app' })
    expect(source.projectUrls.get('ENG')).toBeUndefined()
    await source.chainTasks('ENG', notTerminal)
    expect(calls[1]!.variables).toEqual({ team: 'ENG', project: 'Web app' })
    expect(calls[2]!.variables).toMatchObject({ filter: { project: { id: { eq: 'project-web' } } } })
    expect(source.projectUrls.get('ENG')).toBe(`${url}/issues`)
  })

  it('fails on a project the team does not have and on a team it cannot see', async () => {
    const { source } = await connect([team([]), notFound('Team')], { ENG: 'Web app' })
    await expect(source.chainTasks('ENG', notTerminal)).rejects.toThrow(/ENG.*Web app/)
    await expect(source.chainTasks('ENG', notTerminal)).rejects.toThrow(/team ENG.*Entity not found/)
  })

  it('adds the closed issues of the milestones its open leaf issues are in', async () => {
    const v1 = { id: 'm1', name: 'v1.0', targetDate: null }
    const { source, calls } = await connect([
      team(),
      { body: { data: { issues: page([issue('ENG-1', { projectMilestone: v1 }), issue('ENG-2', { children: { nodes: [{ id: 'c' }] }, projectMilestone: { ...v1, id: 'm2' } })]) } } },
      { body: { data: { issues: page([issue('ENG-3', { state: { name: 'Done', type: 'completed' }, projectMilestone: v1 })]) } } },
    ])
    const { tasks } = await source.chainTasks('ENG', notTerminal)
    expect(tasks.map((task) => [task.id, task.status.category])).toEqual([
      ['ENG-1', 'ToDo'],
      ['ENG-2', 'ToDo'],
      ['ENG-3', 'Won'],
    ])
    expect(calls[3]!.variables).toMatchObject({
      filter: { team: { id: { eq: 'team-eng' } }, state: { id: { in: ['s-done', 's-canceled'] } }, projectMilestone: { id: { in: ['m1'] } } },
    })
  })

  it('reads tasks by id team by team, leaving out what is gone and what is not a task id', async () => {
    const { source, calls } = await connect([
      { body: { data: { t0: { nodes: [issue('ENG-12', { state: { name: 'Canceled', type: 'canceled' } })] }, t1: { nodes: [issue('OPS-1')] } } } },
    ])
    const tasks = await source.tasks(['ENG-12', 'ENG-99', 'OPS-1', 'junk'])
    expect(tasks.map((task) => [task.id, task.status.name])).toEqual([
      ['ENG-12', 'Canceled'],
      ['OPS-1', 'Todo'],
    ])
    expect(calls[1]!.query).toContain('t0: issues(')
    expect(calls[1]!.variables).toEqual({
      f0: { team: { key: { eq: 'ENG' } }, number: { in: [12, 99] } },
      f1: { team: { key: { eq: 'OPS' } }, number: { in: [1] } },
    })
  })

  it('asks nothing for an empty list', async () => {
    const { source, calls } = await connect([])
    expect(await source.tasks(['junk'])).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('gives the title and the description as the brief', async () => {
    const { source } = await connect([
      { body: { data: { issues: { nodes: [{ title: 'Add login', description: 'Use **OAuth**.' }] } } } },
      { body: { data: { issues: { nodes: [{ title: 'Empty', description: null }] } } } },
      { body: { data: { issues: { nodes: [] } } } },
    ])
    expect(await source.brief!('ENG-7')).toEqual({ title: 'Add login', description: 'Use **OAuth**.' })
    expect(await source.brief!('ENG-8')).toEqual({ title: 'Empty', description: '' })
    await expect(source.brief!('ENG-9')).rejects.toThrow(/ENG-9/)
  })

  it('moves an open issue to the first completed state of its team', async () => {
    const states = { nodes: [{ id: 's-shipped', position: 5 }, { id: 's-done', position: 3 }] }
    const { source, calls } = await connect([
      { body: { data: { issues: { nodes: [{ id: 'uuid-eng-7', state: { type: 'started' }, team: { states } }] } } } },
      { body: { data: { issueUpdate: { success: true } } } },
    ])
    expect(await source.complete!('ENG-7')).toBe(true)
    expect(calls[1]!.variables).toEqual({ filter: { team: { key: { eq: 'ENG' } }, number: { eq: 7 } } })
    expect(calls[2]!.query).toContain('issueUpdate')
    expect(calls[2]!.variables).toEqual({ id: 'uuid-eng-7', state: 's-done' })
  })

  it('leaves a closed issue alone', async () => {
    for (const type of ['completed', 'canceled', 'duplicate']) {
      const { source, calls } = await connect([{ body: { data: { issues: { nodes: [{ id: 'uuid-eng-7', state: { type }, team: { states: { nodes: [] } } }] } } } }])
      expect(await source.complete!('ENG-7')).toBe(false)
      expect(calls).toHaveLength(2)
    }
  })

  it('fails to complete an issue it cannot find', async () => {
    const { source } = await connect([{ body: { data: { issues: { nodes: [] } } } }])
    await expect(source.complete!('ENG-7')).rejects.toThrow(/ENG-7/)
  })

  it('posts a comment on the issue and gives its id', async () => {
    const { source, calls } = await connect([
      { body: { data: { issues: { nodes: [{ id: 'uuid-eng-7' }] } } } },
      { body: { data: { commentCreate: { success: true, comment: { id: 'c-1' } } } } },
    ])
    expect(await source.comment!('ENG-7', 'Which one?')).toBe('c-1')
    expect(calls[2]!.variables).toEqual({ id: 'uuid-eng-7', body: 'Which one?' })
  })

  it('creates an issue in the first unstarted state, in the project and the milestone of the given task', async () => {
    const { source, calls } = await connect([
      team(),
      { body: { data: { issues: { nodes: [{ project: { id: 'project-web' }, projectMilestone: { id: 'milestone-1' } }] } } } },
      { body: { data: { issueCreate: { success: true, issue: { identifier: 'ENG-42' } } } } },
    ])
    const id = await source.create!({ project: 'ENG', title: 'CI on main failed: abcdef1', description: 'Log', priority: 'high', milestoneOf: 'ENG-7' })
    expect(id).toBe('ENG-42')
    expect(calls[2]!.variables).toEqual({ filter: { team: { key: { eq: 'ENG' } }, number: { eq: 7 } } })
    expect(calls[3]!.variables).toEqual({
      input: { teamId: 'team-eng', title: 'CI on main failed: abcdef1', description: 'Log', priority: 2, stateId: 's-todo', projectId: 'project-web', projectMilestoneId: 'milestone-1' },
    })
  })

  it('creates an issue in the project of the config when no task gives a place', async () => {
    const { source, calls } = await connect([team([{ id: 'project-web' }]), { body: { data: { issueCreate: { success: true, issue: { identifier: 'ENG-43' } } } } }], { ENG: 'Web app' })
    expect(await source.create!({ project: 'ENG', title: 'T', description: 'D', priority: 'high', milestoneOf: null })).toBe('ENG-43')
    expect(calls[2]!.variables).toEqual({ input: { teamId: 'team-eng', title: 'T', description: 'D', priority: 2, stateId: 's-todo', projectId: 'project-web' } })
  })

  it('puts an issue without a milestone into the milestone of another issue, with its project when the issue has none', async () => {
    const place = (id: string, project: string | null, milestone: string | null) => ({
      body: { data: { issues: { nodes: [{ id, project: project === null ? null : { id: project }, projectMilestone: milestone === null ? null : { id: milestone } }] } } },
    })
    const moved = { body: { data: { issueUpdate: { success: true } } } }
    const { source, calls } = await connect([
      place('issue-9', 'project-web', null),
      place('issue-7', 'project-web', 'milestone-1'),
      moved,
      place('issue-9', null, null),
      place('issue-7', 'project-web', 'milestone-1'),
      moved,
    ])
    expect(await source.setMilestone!('ENG-9', 'ENG-7')).toBe(true)
    expect(calls[1]!.variables).toEqual({ filter: { team: { key: { eq: 'ENG' } }, number: { eq: 9 } } })
    expect(calls[3]!.variables).toEqual({ id: 'issue-9', input: { projectMilestoneId: 'milestone-1' } })
    expect(await source.setMilestone!('ENG-9', 'ENG-7')).toBe(true)
    expect(calls[6]!.variables).toEqual({ id: 'issue-9', input: { projectId: 'project-web', projectMilestoneId: 'milestone-1' } })
  })

  it('leaves alone an issue that has a milestone, and one whose model has none or is in another project', async () => {
    const place = (project: string | null, milestone: string | null) => ({
      body: { data: { issues: { nodes: [{ id: 'issue', project: project === null ? null : { id: project }, projectMilestone: milestone === null ? null : { id: milestone } }] } } },
    })
    const { source, calls } = await connect([
      place('project-web', 'milestone-2'),
      place('project-web', null),
      place('project-web', null),
      place('project-web', null),
      place('project-api', 'milestone-1'),
    ])
    expect(await source.setMilestone!('ENG-9', 'ENG-7')).toBe(false)
    expect(await source.setMilestone!('ENG-9', 'ENG-7')).toBe(false)
    expect(await source.setMilestone!('ENG-9', 'ENG-7')).toBe(false)
    expect(calls).toHaveLength(6)
  })

  it('offers the milestones of the issue project, none for an issue without one', async () => {
    const nodes = [{ id: 'milestone-1', name: 'v0.1', targetDate: '2026-10-21' }, { id: 'milestone-2', name: 'v0.2', targetDate: null }]
    const { source } = await connect([
      { body: { data: { issues: { nodes: [{ projectMilestone: { id: 'milestone-2' }, project: { projectMilestones: { nodes } } }] } } } },
      { body: { data: { issues: { nodes: [{ projectMilestone: null, project: null }] } } } },
    ])
    expect(await source.milestones!('ENG-9')).toEqual({
      current: 'milestone-2',
      choices: [
        { id: 'milestone-1', label: 'v0.1', targetDate: Date.parse('2026-10-21') },
        { id: 'milestone-2', label: 'v0.2', targetDate: null },
      ],
    })
    expect(await source.milestones!('ENG-9')).toEqual({ current: null, choices: [] })
  })

  it('moves an issue into a milestone or out of any', async () => {
    const found = { body: { data: { issues: { nodes: [{ id: 'issue-9' }] } } } }
    const moved = { body: { data: { issueUpdate: { success: true } } } }
    const { source, calls } = await connect([found, moved, found, moved])
    await source.moveMilestone!('ENG-9', 'milestone-1')
    expect(calls[2]!.variables).toEqual({ id: 'issue-9', input: { projectMilestoneId: 'milestone-1' } })
    await source.moveMilestone!('ENG-9', null)
    expect(calls[4]!.variables).toEqual({ id: 'issue-9', input: { projectMilestoneId: null } })
  })

  it('gives the comments after a given one, oldest first, with the files they link to', async () => {
    const nodes = [
      { id: 'c-2', body: '[logs.zip](https://uploads.linear.app/org/logs.zip)', createdAt: '2026-10-11T10:02:00.000Z' },
      { id: 'c-1', body: 'Which one?', createdAt: '2026-10-11T10:01:00.000Z' },
      { id: 'c-0', body: 'earlier', createdAt: '2026-10-11T10:00:00.000Z' },
    ]
    const { source } = await connect([{ body: { data: { issues: { nodes: [{ comments: { nodes } }] } } } }])
    expect(await source.commentsAfter!('ENG-7', 'c-1')).toEqual([
      { id: 'c-2', body: nodes[0]!.body, files: [{ name: 'logs.zip', file: 'https://uploads.linear.app/org/logs.zip' }] },
    ])
  })

  it('serves no file from outside the upload host', async () => {
    const { source } = await connect([])
    expect(await source.file!('ENG-7', 'https://example.com/steal')).toBeNull()
  })

  it('names the states of the team and the labels of the team and the workspace, without label groups', async () => {
    const { source, calls } = await connect([
      team(),
      { body: { data: { issueLabels: page([{ name: 'Bug', isGroup: false }, { name: 'Area', isGroup: true }], 'cursor-1') } } },
      { body: { data: { issueLabels: page([{ name: 'Question', isGroup: false }, { name: 'Bug', isGroup: false }]) } } },
    ])
    expect(await source.vocabulary!('ENG')).toEqual({
      statuses: ['Backlog', 'Todo', 'In Progress', 'Done', 'Canceled'],
      labels: ['Bug', 'Question'],
    })
    expect(calls[2]!.variables).toEqual({ team: 'team-eng', after: null })
    expect(calls[3]!.variables).toEqual({ team: 'team-eng', after: 'cursor-1' })
  })
})
