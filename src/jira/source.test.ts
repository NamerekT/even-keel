import { describe, expect, it } from 'vitest'
import { NoticeError } from '../notice/notice.js'
import { CredentialsRefused } from '../tracker/source.js'
import { BACKLOG, blockedBy, DONE, fakeFetch, issue, PROGRESS, TODO, type Reply } from './fixture.js'
import { connectJira } from './source.js'

const SITE = 'https://example.atlassian.net'
const SETTINGS = { values: { JIRA_URL: SITE, JIRA_EMAIL: 'john.doe@example.com', JIRA_TOKEN: 'example-token' }, projects: { 'project-id': { key: 'ABC' } } }
const MYSELF: Reply = { body: { accountId: 'account-1', displayName: 'John Doe', emailAddress: 'john.doe@example.com' } }
const LINK_TYPES: Reply = { body: { issueLinkTypes: [{ name: 'Blocks' }, { name: 'Relates' }] } }
const PRIORITIES: Reply = { body: { values: ['Highest', 'High', 'Medium', 'Low', 'Lowest'].map((name, index) => ({ id: String(index + 1), name })) } }
const STATUSES: Reply = { body: [{ statuses: [BACKLOG, TODO, PROGRESS] }, { statuses: [TODO, DONE] }] }
const notTerminal = (status: { category: string }) => status.category !== 'Won' && status.category !== 'UnStarted'
const doc = (text: string) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

async function connect(replies: Reply[]) {
  const fake = fakeFetch([MYSELF, LINK_TYPES, ...replies])
  const lines: string[] = []
  const source = await connectJira(SETTINGS, 1000, fake.fetch, (line) => lines.push(line))
  return { source, ...fake, lines }
}

describe('connectJira', () => {
  it('signs in with Basic e-mail:token on the site', async () => {
    const { calls } = await connect([])
    expect(calls[0]!.url).toBe(`${SITE}/rest/api/3/myself`)
    expect(calls[0]!.headers.get('authorization')).toBe(`Basic ${Buffer.from('john.doe@example.com:example-token').toString('base64')}`)
  })

  it('goes through the gateway of the site’s cloud id when the site refuses a scoped token', async () => {
    const fake = fakeFetch([{ status: 401 }, { body: { cloudId: 'cloud-1' } }, MYSELF, LINK_TYPES, { body: { fields: { summary: 'Title', description: null } } }])
    const source = await connectJira(SETTINGS, 1000, fake.fetch)
    expect(fake.calls[1]!.url).toBe(`${SITE}/_edge/tenant_info`)
    expect(fake.calls[2]!.url).toBe('https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/myself')
    expect(await source.brief!('ABC-1')).toEqual({ title: 'Title', description: '' })
    expect(fake.calls[4]!.url).toContain('https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/issue/ABC-1')
  })

  it('refuses credentials both ways refuse, and a site without a Blocks link type', async () => {
    await expect(connectJira(SETTINGS, 1000, fakeFetch([{ status: 401 }, { body: { cloudId: 'cloud-1' } }, { status: 401 }]).fetch)).rejects.toBeInstanceOf(CredentialsRefused)
    const renamed = connectJira(SETTINGS, 1000, fakeFetch([MYSELF, { body: { issueLinkTypes: [{ name: 'Depends' }] } }]).fetch)
    await expect(renamed).rejects.toBeInstanceOf(NoticeError)
    await expect(connectJira(SETTINGS, 1000, fakeFetch([MYSELF, { body: { issueLinkTypes: [{ name: 'Depends' }] } }]).fetch)).rejects.toThrow('it has: Depends')
  })
})

describe('Jira task source', () => {
  it('reads the open issues by status id, the closed ones of their versions and the children of epics', async () => {
    const epic = issue('ABC-4', { issuetype: { hierarchyLevel: 1 } })
    const { source, calls, remaining } = await connect([
      STATUSES,
      { body: { issues: [issue('ABC-1', { issuelinks: [blockedBy('ABC-2')], fixVersions: [{ id: '20', name: 'v1.0', releaseDate: '2026-11-01' }] })], nextPageToken: 'next' } },
      { body: { issues: [epic] } },
      { body: { issues: [issue('ABC-2', { status: DONE, fixVersions: [{ id: '20', name: 'v1.0' }] })] } },
      PRIORITIES,
      { body: { issues: [issue('ABC-5', { parent: { key: 'ABC-4', fields: { summary: 'Epic', status: TODO } } }), issue('ABC-6', { parent: { key: 'ABC-4', fields: { summary: 'Epic', status: TODO } } })] } },
    ])
    const result = await source.chainTasks('project-id', notTerminal)
    expect(result.statuses).toEqual(['Backlog', 'To Do', 'In Progress', 'Done'])
    expect(result.tasks.map((task) => [task.id, task.status.category, task.subtasks])).toEqual([['ABC-1', 'ToDo', 0], ['ABC-4', 'ToDo', 2], ['ABC-2', 'Won', 0]])
    expect(result.tasks[0]!.blockedBy).toEqual(['ABC-2'])
    expect(calls[3]).toMatchObject({ method: 'POST', url: `${SITE}/rest/api/3/search/jql` })
    expect(calls[3]!.body).toMatchObject({ jql: 'project = "ABC" AND status in (10001, 3) ORDER BY key' })
    expect(calls[4]!.body).toMatchObject({ nextPageToken: 'next' })
    expect(calls[5]!.body).toMatchObject({ jql: 'project = "ABC" AND status in (10000, 10002) AND fixVersion in (20) ORDER BY key' })
    expect(calls[7]!.body).toMatchObject({ jql: 'parent in (ABC-4)', fields: ['parent'] })
    expect(remaining()).toBe(0)
  })

  it('reads tasks by id in bulk, leaving out the ones Jira no longer has', async () => {
    const { source, calls } = await connect([{ body: { issues: [issue('ABC-1')], issueErrors: [{ errorMessages: ['ABC-9 is gone'] }] } }, PRIORITIES])
    expect((await source.tasks(['ABC-1', 'ABC-9', 'not an id'])).map((task) => task.id)).toEqual(['ABC-1'])
    expect(calls[2]!.body).toMatchObject({ issueIdsOrKeys: ['ABC-1', 'ABC-9'] })
  })

  it('closes through the first transition to a Done status, and says why when there is none', async () => {
    const { source, calls, lines } = await connect([
      { body: { fields: { status: PROGRESS } } },
      { body: { transitions: [{ id: '11', name: 'Back', to: TODO }, { id: '31', name: 'Finish', to: DONE }, { id: '41', name: 'Reject', to: { ...DONE, name: 'Rejected' } }] } },
      { status: 204 },
      { body: { fields: { status: DONE } } },
      { body: { fields: { status: PROGRESS } } },
      { body: { transitions: [{ id: '11', name: 'Back', to: TODO }] } },
    ])
    expect(await source.complete!('ABC-1')).toBe(true)
    expect(calls[4]).toMatchObject({ method: 'POST', url: `${SITE}/rest/api/3/issue/ABC-1/transitions`, body: { transition: { id: '31' } } })
    expect(await source.complete!('ABC-1')).toBe(false)
    expect(await source.complete!('ABC-1')).toBe(false)
    expect(lines).toEqual(['jira: ABC-1 is not closed: its workflow has no transition from In Progress to a status of the Done category'])
  })

  it('moves a backlog issue to the first ready status and leaves a ready one alone', async () => {
    const { source, calls } = await connect([
      { body: { fields: { status: BACKLOG } } },
      { body: { transitions: [{ id: '21', name: 'Start', to: PROGRESS }, { id: '11', name: 'Ready', to: TODO }] } },
      { status: 204 },
      { body: { fields: { status: TODO } } },
    ])
    expect(await source.ready!('ABC-1')).toEqual({ name: 'To Do', category: 'ToDo' })
    expect(calls[4]!.body).toEqual({ transition: { id: '11' } })
    expect(await source.ready!('ABC-1')).toBeNull()
  })

  it('posts a comment as ADF and reads the later ones as Markdown with their files', async () => {
    const media = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }, { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'm', alt: 'log.txt' } }] }] }
    const { source, calls } = await connect([
      { body: { id: '100' } },
      { body: { comments: [{ id: '100', created: '2026-10-01T00:00:00.000+0000', body: doc('Question') }, { id: '101', created: '2026-10-01T00:01:00.000+0000', body: media }], total: 2 } },
      { body: { fields: { attachment: [{ id: '500', filename: 'log.txt', mimeType: 'text/plain', size: 10 }] } } },
    ])
    expect(await source.comment!('ABC-1', '**Which?**')).toBe('100')
    expect(calls[2]!.body).toEqual({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Which?', marks: [{ type: 'strong' }] }] }] } })
    expect(await source.commentsAfter!('ABC-1', '100')).toEqual([{ id: '101', body: '1\n\n(attachment: log.txt)', files: [{ name: 'log.txt', file: '500' }] }])
  })

  it('creates a task of the project’s Task type with the priority and the version of the given task, and readies it', async () => {
    const { source, calls } = await connect([
      { body: { issueTypes: [{ id: '1', name: 'Epic', hierarchyLevel: 1 }, { id: '2', name: 'Sub-task', subtask: true, hierarchyLevel: -1 }, { id: '3', name: 'Task', hierarchyLevel: 0 }] } },
      PRIORITIES,
      { body: { fields: { fixVersions: [{ id: '21', name: 'v1.1', releaseDate: '2026-12-01' }, { id: '20', name: 'v1.0', releaseDate: '2026-11-01' }] } } },
      { body: { key: 'ABC-10' } },
      { body: { fields: { status: TODO } } },
    ])
    expect(await source.create!({ project: 'project-id', title: 'Fix main', description: 'Red', priority: 'high', milestoneOf: 'ABC-1' })).toBe('ABC-10')
    expect(calls[5]!.body).toEqual({
      fields: { project: { key: 'ABC' }, issuetype: { id: '3' }, summary: 'Fix main', description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Red' }] }] }, priority: { id: '2' }, fixVersions: [{ id: '20' }] },
    })
  })

  it('fills, offers and moves versions', async () => {
    const { source, calls } = await connect([
      { body: { fields: { fixVersions: [] } } },
      { body: { fields: { fixVersions: [{ id: '20', name: 'v1.0' }] } } },
      { status: 204 },
      { body: { fields: { fixVersions: [{ id: '19', name: 'v0.9', released: true }] } } },
      { body: [{ id: '19', name: 'v0.9', released: true }, { id: '20', name: 'v1.0', releaseDate: '2026-11-01' }, { id: '18', name: 'old', archived: true }] },
      { status: 204 },
    ])
    expect(await source.setMilestone!('ABC-1', 'ABC-2')).toBe(true)
    expect(calls[4]).toMatchObject({ method: 'PUT', body: { fields: { fixVersions: [{ id: '20' }] } } })
    expect(await source.setMilestone!('ABC-1', 'XYZ-2')).toBe(false)
    expect(await source.milestones!('ABC-1')).toEqual({
      current: '19',
      choices: [{ id: '20', label: 'v1.0', targetDate: Date.parse('2026-11-01') }, { id: '19', label: 'v0.9', targetDate: null }],
    })
    await source.moveMilestone!('ABC-1', null)
    expect(calls[7]!.body).toEqual({ fields: { fixVersions: [] } })
  })

  it('offers the project’s statuses, labels across pages and open versions', async () => {
    const { source } = await connect([
      STATUSES,
      { body: { values: ['ui'], isLast: false } },
      { body: { values: ['Question'], isLast: true } },
      { body: [{ id: '20', name: 'v1.0' }, { id: '19', name: 'v0.9', released: true }] },
    ])
    expect(await source.vocabulary!('project-id')).toEqual({
      statuses: [{ name: 'Backlog', category: 'UnStarted' }, { name: 'To Do', category: 'ToDo' }, { name: 'In Progress', category: 'Active' }, { name: 'Done', category: 'Won' }],
      labels: ['ui', 'Question'],
      milestones: ['v1.0'],
    })
  })

  it('lists the tasks of a version with their newest comment', async () => {
    const { source, calls } = await connect([
      { body: [{ id: '20', name: 'v1.0' }] },
      { body: { issues: [issue('ABC-1', { status: DONE })] } },
      PRIORITIES,
      { body: { comments: [{ id: '9', created: '2026-10-01T00:00:00.000+0000', body: doc('Closing note') }], total: 3 } },
      { body: [{ id: '20', name: 'v1.0' }] },
    ])
    expect(await source.milestoneTasks!('project-id', 'v1.0')).toMatchObject([{ id: 'ABC-1', lastComment: 'Closing note' }])
    expect(calls[5]!.url).toContain('orderBy=-created&startAt=0&maxResults=1')
    expect(await source.milestoneTasks!('project-id', 'v9')).toEqual([])
  })

  it('serves only a file of the issue', async () => {
    const { source, calls } = await connect([
      { body: { fields: { attachment: [{ id: '500', filename: 'log.txt', mimeType: 'text/plain', size: 5 }] } } },
      { body: 'hello' },
      { body: { fields: { attachment: [] } } },
    ])
    const file = await source.file!('ABC-1', '500')
    expect(file).toMatchObject({ type: 'text/plain', size: 5 })
    expect(calls[3]!.url).toBe(`${SITE}/rest/api/3/attachment/content/500?redirect=false`)
    expect(await source.file!('ABC-1', '501')).toBeNull()
    expect(await source.file!('ABC-1', '../x')).toBeNull()
  })
})
