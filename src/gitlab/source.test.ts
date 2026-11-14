import { describe, expect, it } from 'vitest'
import { CredentialsRefused, TrackerNotFound } from '../tracker/source.js'
import { fakeFetch, issue, linked, note, type Reply } from './fixture.js'
import { connectGitlab } from './source.js'

const SETTINGS = { web: 'https://gitlab.example.com', token: 'example', projects: { 'project-id': { key: 'APP', value: 'group/subgroup/app' } } }
const USER: Reply = { body: { id: 9, username: 'example-user' } }
const NO_HIERARCHY: Reply = { body: { data: { project: { workItems: { nodes: [{ widgets: [] }] } } } } }
const batchHierarchy = (...iids: number[]): Reply => ({ body: { data: { project: { workItems: { nodes: iids.map((iid) => ({ iid: String(iid), widgets: [] })), pageInfo: { hasNextPage: false, endCursor: null } } } } } })
const notTerminal = (status: { category: string }) => status.category !== 'Won'
/** The notes and label events of an outsider's issue without changes (BTN-1124). */
const NO_EDITS: Reply[] = [{ body: [] }, { body: [] }]

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
      batchHierarchy(1, 3), { body: [linked('is_blocked_by', 2)] }, { body: [] },
    ])
    const result = await source.chainTasks('project-id', notTerminal)
    expect(result.statuses).toEqual(['Opened', 'Closed'])
    expect(result.tasks.map((task) => task.id)).toEqual(['APP-1', 'APP-3', 'APP-2'])
    expect(result.tasks[0]!.blockedBy).toEqual(['APP-2'])
    expect(calls[1]!.url).toContain('/projects/group%2Fsubgroup%2Fapp/issues?state=opened')
    expect(calls[3]!.url).toContain('state=closed&milestone=v1.0')
    expect(calls[4]!.body?.variables).toMatchObject({ iids: ['1', '3'] })
    expect(remaining()).toBe(0)
  })

  it('marks the open issues of outsiders, asking after each author once (BTN-1123)', async () => {
    const at = (iid: number, author: { id: number; username: string } | null) => issue({ iid, milestone: null, web_url: `${SETTINGS.web}/group/subgroup/app/-/issues/${iid}`, author })
    const { source, calls, remaining } = await connect([
      { body: [at(1, { id: 9, username: 'example-user' }), at(2, { id: 30, username: 'stranger' }), at(3, { id: 31, username: 'reporter' }), at(4, { id: 30, username: 'stranger' }), at(5, null), issue({ iid: 6, milestone: null, web_url: `${SETTINGS.web}/group/subgroup/app/-/issues/6` })] },
      batchHierarchy(1, 2, 3, 4, 5, 6), { body: [] }, { body: [] }, { body: [] }, { body: [] }, { body: [] }, { body: [] },
      { status: 404, body: {} }, ...NO_EDITS, { body: { access_level: 30 } }, ...NO_EDITS, ...NO_EDITS,
    ])
    const { tasks } = await source.chainTasks('project-id', notTerminal)
    expect(tasks.map((task) => [task.id, task.outsider])).toEqual([['APP-1', undefined], ['APP-2', true], ['APP-3', undefined], ['APP-4', true], ['APP-5', true], ['APP-6', undefined]])
    expect(calls.filter((call) => call.url.includes('/members/all/')).map((call) => call.url.split('/').pop())).toEqual(['30', '31'])
    expect(remaining()).toBe(0)
  })

  it('marks outsiders\' open issues in the tasks tools\' list too, without their text changes (BTN-1125)', async () => {
    const at = (iid: number, author: { id: number; username: string }) => issue({ iid, milestone: null, web_url: `${SETTINGS.web}/group/subgroup/app/-/issues/${iid}`, author })
    const { source, calls, remaining } = await connect([
      { body: [at(1, { id: 9, username: 'example-user' }), at(2, { id: 30, username: 'stranger' })] },
      batchHierarchy(1, 2), { body: [] }, { body: [] }, { status: 404, body: {} },
    ])
    const tasks = await source.editor!.list('project-id')
    expect(tasks.map((task) => [task.id, task.outsider])).toEqual([['APP-1', undefined], ['APP-2', true]])
    expect(calls.some((call) => call.url.includes('/notes') || call.url.includes('resource_label_events'))).toBe(false)
    expect(remaining()).toBe(0)
  })

  it('reads the text changes of an outsider\'s open issue by its author, with the label puttings (BTN-1124)', async () => {
    const note = (id: number, body: string, author: number | null, at: string) => ({ id, body, created_at: at, system: true, author: author === null ? null : { id: author, username: 'someone' } })
    const { source, calls, remaining } = await connect([
      { body: [issue({ iid: 1, milestone: null, author: { id: 30, username: 'stranger' } })] },
      batchHierarchy(1), { body: [] }, { status: 404, body: {} },
      {
        body: [
          note(1, 'changed the description', 30, '2026-01-02T10:05:00Z'),
          note(2, 'changed title from **a** to **b**', 30, '2026-01-02T10:07:00Z'),
          note(3, 'changed the description', 9, '2026-01-02T10:30:00Z'),
          note(4, 'added ~"bug" label', 30, '2026-01-02T10:40:00Z'),
        ],
      },
      { body: [{ created_at: '2026-01-02T10:01:00Z', action: 'add', label: { name: 'even-keel: approved' } }, { created_at: '2026-01-02T10:02:00Z', action: 'remove', label: { name: 'bug' } }] },
    ])
    const { tasks } = await source.chainTasks('project-id', notTerminal)
    expect(tasks[0]!.edited).toEqual({ at: Date.parse('2026-01-02T10:07:00Z'), labeled: [{ label: 'even-keel: approved', at: Date.parse('2026-01-02T10:01:00Z') }] })
    expect(calls.at(-1)!.url).toContain('/issues/1/resource_label_events')
    expect(remaining()).toBe(0)
  })

  it('leaves related links unordered on Free and propagates link API failures', async () => {
    const { source } = await connect([{ body: [issue({ milestone: null })] }, batchHierarchy(1), { body: [linked('relates_to', 2)] }])
    expect((await source.chainTasks('project-id', notTerminal)).tasks[0]!.blockedBy).toEqual([])
    const denied = await connect([{ body: [issue({ milestone: null })] }, batchHierarchy(1), { status: 403, body: {} }])
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

  it('keeps untrusted comments on the user-facing card, marked, but not system notes', async () => {
    const notes = [
      note(1, { author: { id: 30, username: 'outsider' } }), note(2, { system: true }), note(3, { author: { id: 31, username: 'reporter' } }),
      note(4), note(5, { author: { id: 32, username: 'bot' } }), note(6, { author: null }), note(7, { author: { id: 30, username: 'outsider' } }),
    ]
    const { source, calls, remaining } = await connect([
      { body: issue() }, { body: [linked('blocks', 2)] }, { body: notes }, NO_HIERARCHY,
      { status: 404, body: {} }, { body: { access_level: 20 } }, { body: { access_level: 10 } },
    ])
    const card = await source.card!('APP-1')
    expect(card.blocks[0]!.id).toBe('APP-2')
    expect(card.comments.map((each) => [each.author, each.outsider])).toEqual([
      ['outsider', true], ['reporter', undefined], ['example-user', undefined], ['bot', true], [null, true], ['outsider', true],
    ])
    expect(calls.filter((call) => call.url.includes('/members/all/'))).toHaveLength(3)
    expect(remaining()).toBe(0)
  })

  it('marks the card of an outsider\'s open issue (BTN-1123)', async () => {
    const stranger = { author: { id: 30, username: 'stranger' } }
    const { source, remaining } = await connect([{ body: issue(stranger) }, { body: [] }, { body: [] }, NO_HIERARCHY, { status: 404, body: {} }])
    expect((await source.card!('APP-1')).outsider).toBe(true)
    expect(remaining()).toBe(0)
    const closed = await connect([{ body: issue({ ...stranger, state: 'closed' }) }, { body: [] }, { body: [] }, NO_HIERARCHY])
    expect(await closed.source.card!('APP-1')).not.toHaveProperty('outsider')
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
    const { source } = await connect([{ body: [{ id: 20, title: 'v1.0' }] }, { body: [issue()] }, batchHierarchy(1), { body: [] }, { body: [note(1), note(2, { author: { id: 30, username: 'outsider' } })] }, { status: 404, body: {} }])
    expect((await source.milestoneTasks!('project-id', 'v1.0'))[0]!.lastComment).toBe('Note 1')
  })

  it('logs the time spent on an issue in whole minutes, at least one', async () => {
    const { source, calls } = await connect([{ body: {} }, { body: {} }])
    expect(await source.logTime!('APP-4', { hours: 0.29, at: '2026-11-01T10:00:00.000Z', summary: 'Tally' })).toBe(true)
    expect(calls[1]).toMatchObject({ method: 'POST', url: `${SETTINGS.web}/api/v4/projects/group%2Fsubgroup%2Fapp/issues/4/add_spent_time`, body: { duration: '17m', summary: 'Tally' } })
    await source.logTime!('APP-4', { hours: 0.001, at: '2026-11-01T10:00:00.000Z', summary: 'Tally' })
    expect(calls[2]!.body).toMatchObject({ duration: '1m' })
  })

  it('takes a refusal to log time as no report needed, and throws on any other failure', async () => {
    const { source } = await connect([{ status: 403, body: {} }, { status: 500, body: {} }])
    expect(await source.logTime!('APP-4', { hours: 1, at: '2026-11-01T10:00:00.000Z', summary: 'Tally' })).toBe(false)
    await expect(source.logTime!('APP-4', { hours: 1, at: '2026-11-01T10:00:00.000Z', summary: 'Tally' })).rejects.toThrow('HTTP 500')
  })
})
