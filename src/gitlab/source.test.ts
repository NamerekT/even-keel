import { describe, expect, it } from 'vitest'
import { CredentialsRefused, TrackerNotFound } from '../tracker/source.js'
import { fakeFetch, issue, linked, note, type Reply } from './fixture.js'
import { connectGitlab } from './source.js'

const SETTINGS = { web: 'https://gitlab.example.com', token: 'example', projects: { 'project-id': { key: 'APP', value: 'group/subgroup/app' } } }
const USER: Reply = { body: { id: 9, username: 'example-user' } }
const NO_HIERARCHY: Reply = { body: { data: { project: { workItems: { nodes: [{ widgets: [] }] } } } } }
const notTerminal = (status: { category: string }) => status.category !== 'Won'

async function connect(replies: Reply[]) {
  const fake = fakeFetch([USER, ...replies])
  const lines: string[] = []
  const source = await connectGitlab(SETTINGS, 1000, fake.fetch, (line) => lines.push(line))
  return { source, ...fake, lines }
}

describe('GitLab task source', () => {
  it('refuses a bad token on connect', async () => {
    await expect(connectGitlab(SETTINGS, 1000, fakeFetch([{ status: 401, body: {} }]).fetch)).rejects.toBeInstanceOf(CredentialsRefused)
  })

  it('loads all pages of issues, native blockers and terminal issues of active milestones', async () => {
    const { source, calls, remaining } = await connect([
      { body: [issue()], next: '2' }, { body: [issue({ iid: 3, web_url: SETTINGS.web + '/group/subgroup/app/-/issues/3', milestone: null })] },
      { body: [issue({ iid: 2, state: 'closed', web_url: SETTINGS.web + '/group/subgroup/app/-/issues/2' })] },
      { body: [linked('is_blocked_by', 2)] }, NO_HIERARCHY,
      { body: [] }, NO_HIERARCHY,
      { body: [] }, NO_HIERARCHY,
    ])
    const result = await source.chainTasks('project-id', notTerminal)
    expect(result.statuses).toEqual(['Opened', 'Closed'])
    expect(result.tasks.map((task) => task.id)).toEqual(['APP-1', 'APP-3', 'APP-2'])
    expect(result.tasks[0]!.blockedBy).toEqual(['APP-2'])
    expect(calls[1]!.url).toContain('/projects/group%2Fsubgroup%2Fapp/issues?state=opened')
    expect(calls[3]!.url).toContain('state=closed&milestone=v1.0')
    expect(remaining()).toBe(0)
  })

  it('leaves related links unordered on Free and propagates link API failures', async () => {
    const { source } = await connect([{ body: [issue({ milestone: null })] }, { body: [linked('relates_to', 2)] }, NO_HIERARCHY])
    expect((await source.chainTasks('project-id', notTerminal)).tasks[0]!.blockedBy).toEqual([])
    const denied = await connect([{ body: [issue({ milestone: null })] }, { status: 403, body: {} }])
    await expect(denied.source.chainTasks('project-id', notTerminal)).rejects.toThrow('403')
  })

  it('reads briefs and closes only an open issue', async () => {
    const { source, calls } = await connect([{ body: issue() }, { body: issue() }, { body: issue({ state: 'closed' }) }, { body: issue({ state: 'closed' }) }])
    expect(await source.brief!('APP-1')).toEqual({ title: 'Example issue', description: 'Implement the example.' })
    expect(await source.complete!('APP-1')).toBe(true)
    expect(calls[3]).toMatchObject({ method: 'PUT', body: { state_event: 'close' } })
    expect(await source.complete!('APP-1')).toBe(false)
  })

  it('names a task to a merge request by its issue’s address, and none of another tracker', async () => {
    const { source } = await connect([])
    expect(source.closingRef!('APP-7')).toBe('https://gitlab.example.com/group/subgroup/app/-/issues/7')
    expect(source.closingRef!('ABC-7')).toBeNull()
    expect(source.closingRef!('not a task')).toBeNull()
  })

  it('skips deleted tasks but distinguishes a missing project from a missing issue', async () => {
    const { source } = await connect([{ status: 404, body: {} }])
    expect(await source.tasks(['bad', 'APP-99'])).toEqual([])
    const missing = await connect([{ status: 404, body: {} }])
    await expect(missing.source.chainTasks('project-id', notTerminal)).rejects.toBeInstanceOf(TrackerNotFound)
  })

  it('posts notes and accepts only Reporter or above and the token owner after the anchor', async () => {
    const notes = [note(1), note(2, { author: { id: 30, username: 'reporter' } }), note(3, { author: { id: 31, username: 'guest' } }), note(4), note(5, { system: true })]
    const { source, calls, lines } = await connect([{ body: { id: 1 } }, { body: notes }, { body: { access_level: 20 } }, { body: { access_level: 10 } }])
    expect(await source.comment!('APP-1', 'Question')).toBe('1')
    expect(calls[1]).toMatchObject({ method: 'POST', body: { body: 'Question' } })
    expect((await source.commentsAfter!('APP-1', '1')).map((comment) => comment.id)).toEqual(['2', '4'])
    expect(lines).toHaveLength(1)
    expect(calls[3]!.url).toContain('/members/all/30')
  })

  it('fails closed on absent or hidden membership and ignores replies when the anchor was deleted', async () => {
    const { source } = await connect([{ body: [note(1), note(2, { author: { id: 30, username: 'outsider' } })] }, { status: 404, body: {} }, { body: [note(2)] }])
    expect(await source.commentsAfter!('APP-1', '1')).toEqual([])
    expect(await source.commentsAfter!('APP-1', '1')).toEqual([])
  })

  it('keeps untrusted comments on the user-facing card, but not system notes', async () => {
    const { source } = await connect([{ body: issue() }, { body: [linked('blocks', 2)] }, { body: [note(1, { author: { id: 30, username: 'outsider' } }), note(2, { system: true })] }, NO_HIERARCHY])
    const card = await source.card!('APP-1')
    expect(card.blocks[0]!.id).toBe('APP-2')
    expect(card.comments).toHaveLength(1)
    expect(card.comments[0]!.author).toBe('outsider')
  })

  it('copies a milestone only into an empty issue of the same project', async () => {
    const { source, calls } = await connect([{ body: issue({ milestone: null }) }, { body: issue() }, { body: {} }, { body: issue() }])
    expect(await source.setMilestone!('APP-2', 'APP-1')).toBe(true)
    expect(calls[3]!.body).toEqual({ milestone_id: 20 })
    expect(await source.setMilestone!('APP-2', 'APP-1')).toBe(false)
    expect(await source.setMilestone!('APP-2', 'OTHER-1')).toBe(false)
  })

  it('reads native children in every state with their complete task data', async () => {
    const child = { iid: '2', title: 'Child', state: 'CLOSED', webUrl: SETTINGS.web + '/group/subgroup/app/-/work_items/2' }
    const { source } = await connect([
      { body: { data: { project: { workItems: { nodes: [{ widgets: [{ parent: null, children: { nodes: [child], pageInfo: { hasNextPage: false, endCursor: null } } }] }] } } } } },
      { body: issue({ iid: 2, state: 'closed', web_url: child.webUrl }) }, { body: [] }, NO_HIERARCHY,
    ])
    expect(await source.children!('APP-1')).toMatchObject([{ id: 'APP-2', status: { category: 'Won' }, priority: 'medium' }])
  })

  it('lists active milestones plus the current closed one, and clears a milestone with zero', async () => {
    const closed = { id: 20, title: 'v1.0', due_date: null, state: 'closed' }
    const { source, calls } = await connect([{ body: issue({ milestone: closed as NonNullable<ReturnType<typeof issue>['milestone']> }) }, { body: [{ id: 21, title: 'v2.0', due_date: '2026-12-01', state: 'active' }] }, { body: {} }])
    expect(await source.milestones!('APP-1')).toEqual({ current: '20', choices: [{ id: '21', label: 'v2.0', targetDate: Date.parse('2026-12-01') }, { id: '20', label: 'v1.0', targetDate: null }] })
    await source.moveMilestone!('APP-1', null)
    expect(calls.at(-1)!.body).toEqual({ milestone_id: 0 })
  })

  it('creates an issue with a known priority label and an inherited milestone', async () => {
    const { source, calls } = await connect([{ body: [{ name: 'priority::high' }] }, { body: issue() }, { body: issue({ iid: 7 }) }])
    expect(await source.create!({ project: 'project-id', title: 'Fix', description: 'Details', priority: 'high', milestoneOf: 'APP-1' })).toBe('APP-7')
    expect(calls.at(-1)!.body).toEqual({ title: 'Fix', description: 'Details', labels: ['priority::high'], milestone_id: 20 })
  })

  it('exposes native vocabulary and project visibility', async () => {
    const { source } = await connect([{ body: [{ name: 'Auto' }] }, { body: [{ title: 'v1.0' }] }, { body: { visibility: 'public' } }])
    expect(await source.vocabulary!('project-id')).toMatchObject({ labels: ['Auto'], milestones: ['v1.0'] })
    expect(await source.isPublic!('project-id')).toBe(true)
  })

  it('uses only trusted human notes as the last comment in a milestone draft', async () => {
    const { source } = await connect([{ body: [{ id: 20, title: 'v1.0' }] }, { body: [issue()] }, { body: [] }, NO_HIERARCHY, { body: [note(1), note(2, { author: { id: 30, username: 'outsider' } })] }, { status: 404, body: {} }])
    expect((await source.milestoneTasks!('project-id', 'v1.0'))[0]!.lastComment).toBe('Note 1')
  })
})
