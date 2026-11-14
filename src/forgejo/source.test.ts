import { describe, expect, it } from 'vitest'
import type { TaskSource } from '../tracker/source.js'
import { ForgejoScopeError } from './api.js'
import { comment, forgejoFetch, issue, milestone, WEB, type Route } from './fixture.js'
import { connectForgejo } from './source.js'

const BASE = '/repos/example-org/app'
const open = (status: { category: string }) => status.category === 'ToDo'

async function connect(routes: Record<string, Route | ((body: Record<string, unknown> | undefined) => Route)>) {
  const fake = forgejoFetch({ 'GET /user': { body: { login: 'even-keel-bot' } }, ...routes })
  const logs: string[] = []
  const source: TaskSource = await connectForgejo({ web: WEB, token: 'example-token', projects: { 'id-app': { key: 'APP', value: 'example-org/app' } } }, 1000, fake.fetch, (line) => logs.push(line))
  return { source, calls: fake.calls, logs }
}

describe('connectForgejo', () => {
  it('sends the token the way Forgejo takes it', async () => {
    const { calls } = await connect({})
    expect(calls[0]!.headers.get('authorization')).toBe('token example-token')
  })

  it('gives the open issues with their blockers and the closed ones of their milestones, no pull requests', async () => {
    const { source, calls } = await connect({
      [`GET ${BASE}/issues?type=issues&state=open`]: { body: [issue({ number: 1 }), issue({ number: 2, milestone: null }), issue({ number: 5, pull_request: {} })] },
      [`GET ${BASE}/issues?type=issues&state=closed&milestones=20`]: { body: [issue({ number: 3, state: 'closed' })] },
      [`GET ${BASE}/issues/1/dependencies`]: { body: [issue({ number: 3, state: 'closed' })] },
      [`GET ${BASE}/issues/2/dependencies`]: { body: [] },
    })
    const { tasks, statuses } = await source.chainTasks('id-app', open)
    expect(statuses).toEqual(['Open', 'Closed'])
    expect(tasks.map((task) => [task.id, task.status.category, task.blockedBy])).toEqual([['APP-1', 'ToDo', ['APP-3']], ['APP-2', 'ToDo', []], ['APP-3', 'Won', []]])
    expect(calls.some((call) => call.path.includes('/issues/3/dependencies'))).toBe(false)
  })

  it('goes without blockers where the repository has dependencies turned off', async () => {
    const { source } = await connect({
      [`GET ${BASE}/issues?type=issues&state=open`]: { body: [issue({ number: 1, milestone: null }), issue({ number: 2, milestone: null })] },
      [`GET ${BASE}/issues/1/dependencies`]: { status: 404, body: { message: 'dependencies are disabled' } },
      [`GET ${BASE}/issues/2/dependencies`]: { status: 404, body: { message: 'dependencies are disabled' } },
    })
    expect((await source.chainTasks('id-app', open)).tasks.map((task) => task.blockedBy)).toEqual([[], []])
  })

  it('reads the pages up to the total the server gives', async () => {
    const { source } = await connect({
      [`GET ${BASE}/issues?type=issues&state=all`]: { body: [issue({ number: 1, milestone: null })], total: 2 },
      [`GET ${BASE}/issues?type=issues&state=all&limit=50&page=2`]: { body: [issue({ number: 2, milestone: null, state: 'closed' })], total: 2 },
      [`GET ${BASE}/issues/1/dependencies`]: { body: [] },
    })
    expect((await source.chainTasks('id-app', () => true)).tasks.map((task) => task.id)).toEqual(['APP-1', 'APP-2'])
  })

  it('leaves out the tasks it cannot find, of other projects and pull requests', async () => {
    const { source } = await connect({
      [`GET ${BASE}/issues/1`]: { body: issue({ number: 1 }) },
      [`GET ${BASE}/issues/1/dependencies`]: { body: [] },
      [`GET ${BASE}/issues/2`]: { status: 404, body: {} },
      [`GET ${BASE}/issues/5`]: { body: issue({ number: 5, pull_request: {} }) },
    })
    expect((await source.tasks(['APP-1', 'APP-2', 'APP-5', 'XYZ-1'])).map((task) => task.id)).toEqual(['APP-1'])
  })

  it('closes an open issue and leaves a closed one', async () => {
    const { source, calls } = await connect({
      [`GET ${BASE}/issues/1`]: { body: issue({ number: 1 }) },
      [`PATCH ${BASE}/issues/1`]: { body: issue({ number: 1, state: 'closed' }) },
      [`GET ${BASE}/issues/2`]: { body: issue({ number: 2, state: 'closed' }) },
    })
    expect(await source.complete!('APP-1')).toBe(true)
    expect(await source.complete!('APP-2')).toBe(false)
    expect(calls.filter((call) => call.method === 'PATCH').map((call) => call.body)).toEqual([{ state: 'closed' }])
  })

  it('shows both directions of the dependencies on the card', async () => {
    const { source } = await connect({
      [`GET ${BASE}/issues/1`]: { body: issue({ number: 1 }) },
      [`GET ${BASE}/issues/1/dependencies`]: { body: [issue({ number: 2, title: 'Blocker' })] },
      [`GET ${BASE}/issues/1/blocks`]: { body: [issue({ number: 3, title: 'Waits' })] },
      [`GET ${BASE}/issues/1/comments`]: { body: [comment(1)] },
      [`GET ${BASE}/collaborators/john-doe`]: { status: 204 },
    })
    const card = await source.card!('APP-1')
    expect([card.blockedBy.map((ref) => ref.id), card.blocks.map((ref) => ref.id), card.comments.length]).toEqual([['APP-2'], ['APP-3'], 1])
  })

  it('keeps outsiders’ comments on the card, marked: a stranger, a bot, a deleted account', async () => {
    const { source } = await connect({
      [`GET ${BASE}/issues/1`]: { body: issue({ number: 1 }) },
      [`GET ${BASE}/issues/1/dependencies`]: { body: [] },
      [`GET ${BASE}/issues/1/blocks`]: { body: [] },
      [`GET ${BASE}/issues/1/comments`]: {
        body: [
          comment(1),
          comment(2, { user: { login: 'jane-roe' } }),
          comment(3, { user: { login: 'even-keel-bot' } }),
          comment(4, { user: { login: 'example-org' } }),
          comment(5, { user: { login: 'helper-bot' } }),
          comment(6, { user: null }),
        ],
      },
      [`GET ${BASE}/collaborators/john-doe`]: { status: 204 },
      [`GET ${BASE}/collaborators/jane-roe`]: { status: 404, body: {} },
      [`GET ${BASE}/collaborators/jane-roe/permission`]: { status: 403, body: {} },
      [`GET ${BASE}/collaborators/helper-bot`]: { status: 404, body: {} },
      [`GET ${BASE}/collaborators/helper-bot/permission`]: { body: { permission: 'read' } },
    })
    const card = await source.card!('APP-1')
    expect(card.comments.map((each) => [each.author, each.outsider])).toEqual([
      ['john-doe', undefined], ['jane-roe', true], ['even-keel-bot', undefined], ['example-org', undefined], ['helper-bot', true], [null, true],
    ])
  })

  it('skips stale blocks while dependencies are off and reads them again once enabled', async () => {
    let enabled = false
    const { source, calls } = await connect({
      [`GET ${BASE}/issues/1`]: { body: issue({ number: 1 }) },
      [`GET ${BASE}/issues/1/dependencies`]: () => enabled ? { body: [] } : { status: 404, body: {} },
      [`GET ${BASE}/issues/1/blocks`]: { body: [issue({ number: 3, title: 'Waits' })] },
      [`GET ${BASE}/issues/1/comments`]: { body: [comment(1)] },
      [`GET ${BASE}/collaborators/john-doe`]: { status: 204 },
    })
    const card = await source.card!('APP-1')
    expect([card.blockedBy, card.blocks, card.comments.length]).toEqual([[], [], 1])
    expect(calls.some((call) => call.path.endsWith('/blocks'))).toBe(false)

    enabled = true
    const refreshed = await source.card!('APP-1')
    expect([refreshed.blockedBy, refreshed.blocks.map((ref) => ref.id)]).toEqual([[], ['APP-3']])
  })

  it('passes the comments of collaborators, the owner and the token\'s account, and logs each skipped one once', async () => {
    const { source, logs } = await connect({
      [`GET ${BASE}/issues/1/comments`]: {
        body: [
          comment(1),
          comment(2, { user: { login: 'jane-roe' } }),
          comment(3),
          comment(4, { user: { login: 'Even-Keel-Bot' } }),
          comment(5, { user: { login: 'example-org' } }),
          comment(6, { user: { login: 'rick-roe' } }),
          comment(7, { user: null }),
        ],
      },
      [`GET ${BASE}/collaborators/john-doe`]: { status: 204 },
      [`GET ${BASE}/collaborators/jane-roe`]: { status: 404, body: {} },
      [`GET ${BASE}/collaborators/jane-roe/permission`]: { status: 403, body: {} },
      [`GET ${BASE}/collaborators/rick-roe`]: { status: 404, body: {} },
      [`GET ${BASE}/collaborators/rick-roe/permission`]: { body: { permission: 'admin' } },
    })
    expect((await source.commentsAfter!('APP-1', '1')).map((each) => each.id)).toEqual(['3', '4', '5', '6'])
    expect(await source.commentsAfter!('APP-1', '1')).toHaveLength(4)
    expect(logs).toEqual([
      'forgejo: APP-1: the comment 2 of jane-roe is skipped: its author is not a collaborator of example-org/app',
      'forgejo: APP-1: the comment 7 of a deleted account is skipped: its author is not a collaborator of example-org/app',
    ])
    expect(await source.commentsAfter!('APP-1', '99')).toEqual([])
  })

  it('asks each author once per read', async () => {
    const { source, calls } = await connect({
      [`GET ${BASE}/issues/1/comments`]: { body: [comment(1), comment(2), comment(3)] },
      [`GET ${BASE}/collaborators/john-doe`]: { status: 204 },
    })
    await source.commentsAfter!('APP-1', '1')
    expect(calls.filter((call) => call.path.endsWith('/collaborators/john-doe'))).toHaveLength(1)
  })

  it('creates an issue with the priority label the repository has and the milestone of a task of its own', async () => {
    const { source, calls } = await connect({
      [`GET ${BASE}/labels`]: { body: [{ id: 5, name: 'priority/medium' }, { id: 6, name: 'priority: high' }] },
      [`GET /orgs/example-org/labels`]: { status: 404, body: {} },
      [`GET ${BASE}/issues/1`]: { body: issue({ number: 1 }) },
      [`POST ${BASE}/issues`]: { status: 201, body: issue({ number: 12 }) },
    })
    expect(await source.create!({ project: 'id-app', title: 'New', description: 'Text', priority: 'high', milestoneOf: 'APP-1' })).toBe('APP-12')
    expect(calls.at(-1)!.body).toEqual({ title: 'New', body: 'Text', labels: [6], milestone: 20 })
  })

  it('creates an issue bare when there is no such label and the milestone task is of another project', async () => {
    const { source, calls } = await connect({
      [`GET ${BASE}/labels`]: { body: [] },
      [`GET /orgs/example-org/labels`]: { body: [] },
      [`POST ${BASE}/issues`]: { status: 201, body: issue({ number: 13 }) },
    })
    expect(await source.create!({ project: 'id-app', title: 'New', description: '', priority: 'low', milestoneOf: 'XYZ-1' })).toBe('APP-13')
    expect(calls.at(-1)!.body).toEqual({ title: 'New', body: '' })
  })

  const noOrgScope = { status: 403, body: { message: 'token does not have at least one of required scope(s): [read:organization]' } }

  it('creates an issue on a user\'s repository with a token that has no organization scope', async () => {
    const { source } = await connect({
      [`GET ${BASE}/labels`]: { body: [{ id: 6, name: 'priority: high' }] },
      [`GET /orgs/example-org/labels`]: noOrgScope,
      [`GET ${BASE}/teams`]: { status: 405, body: { message: 'repo is not owned by an organization' } },
      [`POST ${BASE}/issues`]: (body) => ({ status: 201, body: issue({ number: 14, labels: [{ id: (body!.labels as number[])[0]!, name: 'priority: high' }] }) }),
    })
    expect(await source.create!({ project: 'id-app', title: 'New', description: '', priority: 'high' })).toBe('APP-14')
  })

  it('names the missing organization scope on an organization\'s repository', async () => {
    const { source } = await connect({
      [`GET ${BASE}/labels`]: { body: [] },
      [`GET /orgs/example-org/labels`]: noOrgScope,
      [`GET ${BASE}/teams`]: { body: [{ id: 1, name: 'Owners' }] },
    })
    await expect(source.create!({ project: 'id-app', title: 'New', description: '', priority: 'high' })).rejects.toBeInstanceOf(ForgejoScopeError)
  })

  it('lists the open milestones with the issue\'s own, and moves the issue to one or to none', async () => {
    const { source, calls } = await connect({
      [`GET ${BASE}/issues/1`]: { body: issue({ number: 1, milestone: milestone({ id: 19, title: 'v0.9', state: 'closed' }) }) },
      [`GET ${BASE}/milestones?state=open`]: { body: [milestone(), milestone({ id: 21, title: 'v1.1', due_on: null })] },
      [`PATCH ${BASE}/issues/1`]: { body: issue() },
    })
    expect(await source.milestones!('APP-1')).toEqual({
      current: '19',
      choices: [
        { id: '20', label: 'v1.0', targetDate: Date.parse('2026-11-01T00:00:00Z') },
        { id: '21', label: 'v1.1', targetDate: null },
        { id: '19', label: 'v0.9', targetDate: Date.parse('2026-11-01T00:00:00Z') },
      ],
    })
    await source.moveMilestone!('APP-1', '21')
    await source.moveMilestone!('APP-1', null)
    await expect(source.moveMilestone!('APP-1', '0')).rejects.toThrow('invalid milestone id')
    expect(calls.filter((call) => call.method === 'PATCH').map((call) => call.body)).toEqual([{ milestone: 21 }, { milestone: 0 }])
  })

  it('sets the milestone of a task of the same project on an issue without one', async () => {
    const { source, calls } = await connect({
      [`GET ${BASE}/issues/2`]: { body: issue({ number: 2, milestone: null }) },
      [`GET ${BASE}/issues/1`]: { body: issue({ number: 1 }) },
      [`PATCH ${BASE}/issues/2`]: { body: issue() },
    })
    expect(await source.setMilestone!('APP-2', 'XYZ-1')).toBe(false)
    expect(await source.setMilestone!('APP-2', 'APP-1')).toBe(true)
    expect(calls.at(-1)!.body).toEqual({ milestone: 20 })
  })

  it('gives a milestone\'s tasks with their last trusted comment', async () => {
    const { source } = await connect({
      [`GET ${BASE}/milestones?state=all&name=v1.0`]: { body: [milestone()] },
      [`GET ${BASE}/issues?type=issues&state=all&milestones=20`]: { body: [issue({ number: 1, state: 'closed' })] },
      [`GET ${BASE}/issues/1/comments`]: { body: [comment(1), comment(2, { user: { login: 'jane-roe' }, body: 'Spam' })] },
      [`GET ${BASE}/collaborators/john-doe`]: { status: 204 },
      [`GET ${BASE}/collaborators/jane-roe`]: { status: 404, body: {} },
      [`GET ${BASE}/collaborators/jane-roe/permission`]: { status: 403, body: {} },
    })
    expect(await source.milestoneTasks!('id-app', 'v1.0')).toMatchObject([{ id: 'APP-1', lastComment: 'Comment 1' }])
    expect(await connect({ [`GET ${BASE}/milestones?state=all&name=v2`]: { body: [] } }).then(({ source: other }) => other.milestoneTasks!('id-app', 'v2'))).toEqual([])
  })

  it('names the statuses, the labels of the repository and its organization and the open milestones', async () => {
    const { source } = await connect({
      [`GET ${BASE}/labels`]: { body: [{ id: 5, name: 'Auto' }] },
      [`GET /orgs/example-org/labels`]: { body: [{ id: 7, name: 'Auto' }, { id: 8, name: 'bug' }] },
      [`GET ${BASE}/milestones?state=open`]: { body: [milestone()] },
    })
    expect(await source.vocabulary!('id-app')).toEqual({ statuses: [{ name: 'Open', category: 'ToDo' }, { name: 'Closed', category: 'Won' }], labels: ['Auto', 'bug'], milestones: ['v1.0'] })
  })

  it('relabels an issue by label ids, creating a missing label', async () => {
    const { source, calls } = await connect({
      [`GET ${BASE}/issues/1`]: { body: issue({ number: 1, labels: [{ id: 5, name: 'priority/medium' }, { id: 9, name: 'Auto' }] }) },
      [`GET ${BASE}/labels`]: { body: [{ id: 5, name: 'priority/medium' }, { id: 9, name: 'Auto' }] },
      [`GET /orgs/example-org/labels`]: { status: 404, body: {} },
      [`POST ${BASE}/labels`]: { status: 201, body: { id: 11, name: 'Вопрос' } },
      [`PUT ${BASE}/issues/1/labels`]: (body) => ({ body: (body!.labels as number[]).map((id) => ({ id, name: id === 11 ? 'Вопрос' : 'priority/medium' })) }),
    })
    expect(await source.relabel!('APP-1', { add: ['Вопрос'], remove: ['auto'] })).toEqual(['priority/medium', 'Вопрос'])
    expect(calls.find((call) => call.method === 'POST')!.body).toEqual({ name: 'Вопрос', color: '#808080' })
    expect(calls.at(-1)!.body).toEqual({ labels: [5, 11] })
  })

  it('takes only a private repository for closed', async () => {
    const { source } = await connect({ [`GET ${BASE}`]: { body: { private: false } } })
    expect(await source.isPublic!('id-app')).toBe(true)
  })
})
