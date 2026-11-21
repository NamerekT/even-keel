import { describe, expect, it } from 'vitest'
import { connectLinear } from './source.js'

const SHOT = 'https://uploads.linear.app/org/shot.png'
const NOTE = 'https://uploads.linear.app/org/note.txt'
const PROJECTS = { 'id-eng': { key: 'ENG', value: '' }, 'id-web': { key: 'WEB', value: 'ENG/Web app' } }

const page = (nodes: unknown[], endCursor: string | null = null) => ({ pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes })
const ref = (number: number, team = 'ENG') => ({ id: `uuid-${team}-${number}`, identifier: `${team}-${number}` })
const user = (id: string, name = id) => ({ id, name })

function issueNode(number: number, fields: Record<string, unknown> = {}) {
  return {
    ...ref(number),
    number,
    title: `Issue ${number}`,
    description: null,
    priority: 0,
    estimate: null,
    trashed: null,
    createdAt: '2026-11-01T10:00:00Z',
    completedAt: null,
    canceledAt: null,
    state: { name: 'Todo', type: 'unstarted' },
    creator: user('u-agent', 'John Doe'),
    parent: null,
    relations: { nodes: [] },
    inverseRelations: { nodes: [] },
    labels: { nodes: [] },
    projectMilestone: null,
    ...fields,
  }
}

interface Graphql {
  query: string
  variables: Record<string, unknown>
}

/** GraphQL answered by what the query reads, page by page; anything else by URL. */
async function connect(
  answers: { issues?: unknown[]; comments?: unknown[]; history?: unknown[]; attachments?: unknown[]; estimation?: string } = {},
  routes: Record<string, () => Response> = {},
  project = 'id-eng',
) {
  const calls: Graphql[] = []
  const requests: string[] = []
  const queue = {
    issues: [...(answers.issues ?? [])],
    comments: [...(answers.comments ?? [])],
    history: [...(answers.history ?? [])],
    attachments: [...(answers.attachments ?? [page([])])],
  }
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (url !== 'https://api.linear.app/graphql') {
      requests.push(url)
      return routes[url]?.() ?? new Response('Not Found', { status: 404 })
    }
    const call = JSON.parse(String(init?.body)) as Graphql
    calls.push(call)
    const { query } = call
    if (query.includes('organization {')) return Response.json({ data: { organization: { urlKey: 'example' } } })
    if (query.includes('viewer {')) return Response.json({ data: { viewer: { id: 'u-agent' } } })
    if (query.includes('creator { id } }')) return Response.json({ data: { project: { creator: { id: 'u-user' } } } })
    if (query.includes('projectMilestones(')) {
      const milestones = (nodes: unknown[]) => ({ nodes })
      const projects = {
        nodes: [
          { id: 'p-web', projectMilestones: milestones([{ name: 'Beta', targetDate: '2026-12-01', description: 'The beta' }, { name: 'GA', targetDate: null, description: null }]) },
          { id: 'p-api', projectMilestones: milestones([{ name: 'beta', targetDate: '2027-01-01', description: '' }, { name: 'API v2', targetDate: null, description: null }]) },
        ],
      }
      return Response.json({ data: { team: { projects } } })
    }
    if (query.includes('team(id:')) {
      const projects = { nodes: [{ id: 'p-web', url: 'https://linear.app/example/project/web' }] }
      return Response.json({ data: { team: { id: 't-eng', issueEstimationType: answers.estimation ?? 'notUsed', states: { nodes: [] }, projects } } })
    }
    if (query.includes('issues(')) return Response.json({ data: { issues: queue.issues.shift() } })
    if (query.includes('comments(')) return Response.json({ data: { issue: { comments: queue.comments.shift() } } })
    if (query.includes('history(')) return Response.json({ data: { issue: { history: queue.history.shift() } } })
    if (query.includes('attachments(')) return Response.json({ data: { issue: { attachments: queue.attachments.shift() } } })
    throw new Error(`unexpected query: ${query}`)
  }
  const source = await connectLinear({ token: 'lin_api_example', projects: PROJECTS }, 5_000, fetch as typeof globalThis.fetch)
  return { importing: await source.importSource!(project), calls, requests }
}

describe('linear import', () => {
  it("reads the milestones of the place's Linear project, or of every project of a team, a name once; Linear keeps no status", async () => {
    const team = await connect()
    expect((await team.importing.milestones()).map((each) => each.name)).toEqual(['Beta', 'GA', 'API v2'])
    const { importing } = await connect({}, {}, 'id-web')
    expect(await importing.milestones()).toEqual([
      { name: 'Beta', date: Date.parse('2026-12-01'), status: 'planned', description: 'The beta', closedAt: null },
      { name: 'GA', date: null, status: 'planned', description: '', closedAt: null },
    ])
    expect(importing.milestoneGaps).toEqual(['status', 'closedAt'])
  })

  it('reads every issue of the team, closed and archived ones too, page by page, with its fields and links', async () => {
    const { importing, calls } = await connect({
      estimation: 'fibonacci',
      issues: [
        page([
          issueNode(2, {
            title: 'Second',
            description: `See ![shot](${SHOT})`,
            priority: 2,
            estimate: 3,
            state: { name: 'Canceled', type: 'canceled' },
            canceledAt: '2026-11-03T12:00:00Z',
            creator: user('u-other', 'Jane Roe'),
            parent: ref(1),
            labels: { nodes: [{ name: 'bug' }] },
            projectMilestone: { name: 'v1.0' },
            inverseRelations: { nodes: [{ type: 'blocks', issue: ref(1) }, { type: 'blocks', issue: ref(9, 'OPS') }, { type: 'related', issue: ref(3) }] },
          }),
          issueNode(3, { trashed: true }),
        ], 'cursor-1'),
        page([
          issueNode(1, {
            relations: { nodes: [{ type: 'blocks', relatedIssue: ref(2) }, { type: 'duplicate', relatedIssue: ref(4) }] },
            parent: ref(5, 'OPS'),
          }),
          issueNode(4, { state: { name: 'Done', type: 'completed' }, completedAt: '2026-11-04T09:00:00Z', creator: null }),
        ]),
      ],
    })
    const tasks = await importing.tasks()
    expect(tasks.map((task) => task.id)).toEqual(['ENG-1', 'ENG-2', 'ENG-4'])
    expect(tasks[1]).toEqual({
      ref: 'uuid-ENG-2',
      number: 2,
      id: 'ENG-2',
      title: 'Second',
      description: `See ![shot](${SHOT})`,
      images: [{ ref: SHOT, file: SHOT }],
      status: { name: 'Canceled', category: 'Lost' },
      priority: 'high',
      milestone: 'v1.0',
      component: null,
      labels: ['bug'],
      estimate: 20,
      parent: { ref: 'uuid-ENG-1', id: 'ENG-1', foreign: false },
      blocks: [],
      blockedBy: [
        { ref: 'uuid-ENG-1', id: 'ENG-1', foreign: false },
        { ref: 'uuid-OPS-9', id: 'OPS-9', foreign: true },
      ],
      related: [],
      createdAt: Date.parse('2026-11-01T10:00:00Z'),
      createdBy: { kind: 'person', name: 'Jane Roe' },
      closedAt: Date.parse('2026-11-03T12:00:00Z'),
      modifiedAt: null,
    })
    expect(tasks[0]).toMatchObject({
      status: { name: 'Todo', category: 'ToDo' },
      priority: 'none',
      estimate: null,
      closedAt: null,
      blocks: [{ ref: 'uuid-ENG-2', id: 'ENG-2', foreign: false }],
      related: [{ ref: 'uuid-ENG-4', id: 'ENG-4', foreign: false }],
      parent: { id: 'OPS-5', foreign: true },
      createdBy: { kind: 'agent', name: 'John Doe' },
    })
    expect(tasks[2]).toMatchObject({ related: [{ id: 'ENG-1' }], closedAt: Date.parse('2026-11-04T09:00:00Z'), createdBy: null })
    const reads = calls.filter((call) => call.query.includes('issues('))
    expect(reads.map((call) => call.variables)).toEqual([
      { filter: { team: { id: { eq: 't-eng' } } }, after: null },
      { filter: { team: { id: { eq: 't-eng' } } }, after: 'cursor-1' },
    ])
    expect(reads[0]!.query).toContain('includeArchived: true')
    await importing.tasks()
    expect(calls.filter((call) => call.query.includes('issues('))).toHaveLength(2)
  })

  it('narrows to the Linear project and takes its creator for the user', async () => {
    const { importing, calls } = await connect({ issues: [page([issueNode(1, { creator: user('u-user', 'Jane Roe') })])] }, {}, 'id-web')
    expect((await importing.tasks())[0]!.createdBy).toEqual({ kind: 'user', name: 'Jane Roe' })
    expect(calls.find((call) => call.query.includes('issues('))!.variables).toEqual({
      filter: { team: { id: { eq: 't-eng' } }, project: { id: { eq: 'p-web' } } },
      after: null,
    })
    expect(calls.find((call) => call.query.includes('creator { id } }'))!.variables).toEqual({ id: 'p-web' })
  })

  it('reads the comments oldest first, a reply with its thread, every upload in them a file at its place', async () => {
    const { importing, calls } = await connect({
      issues: [page([issueNode(1)])],
      comments: [
        page([{ id: 'c-2', body: `Reply [note.txt](${NOTE})`, createdAt: '2026-11-02T10:00:00Z', user: user('u-agent', 'John Doe'), botActor: null, parent: { id: 'c-1' } }], 'c-page'),
        page([
          { id: 'c-1', body: 'First', createdAt: '2026-11-01T11:00:00Z', user: user('u-other', 'Jane Roe'), botActor: null, parent: null },
          { id: 'c-3', body: 'Linked', createdAt: '2026-11-03T11:00:00Z', user: null, botActor: { name: 'GitHub' }, parent: null },
        ]),
      ],
    })
    expect(await importing.comments('uuid-ENG-1')).toEqual([
      { ref: 'c-1', author: { kind: 'person', name: 'Jane Roe' }, at: Date.parse('2026-11-01T11:00:00Z'), body: 'First', images: [], files: [], replyTo: null },
      {
        ref: 'c-2',
        author: { kind: 'agent', name: 'John Doe' },
        at: Date.parse('2026-11-02T10:00:00Z'),
        body: `Reply [note.txt](${NOTE})`,
        images: [{ ref: NOTE, file: NOTE }],
        files: [NOTE],
        replyTo: 'c-1',
      },
      { ref: 'c-3', author: { kind: 'person', name: 'GitHub' }, at: Date.parse('2026-11-03T11:00:00Z'), body: 'Linked', images: [], files: [], replyTo: null },
    ])
    expect(calls.filter((call) => call.query.includes('comments(')).map((call) => call.variables)).toEqual([
      { id: 'uuid-ENG-1', after: null },
      { id: 'uuid-ENG-1', after: 'c-page' },
    ])
  })

  it('gives each upload of the description, the attachments and the comments once and downloads it with the key', async () => {
    const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png', 'content-length': '4' } })
    const { importing, calls, requests } = await connect(
      {
        issues: [page([issueNode(7, { description: `![shot](${SHOT}) and https://example.com/outside.png` })])],
        attachments: [page([{ title: 'Pull request', url: 'https://example.com/pull/1' }, { title: 'Shot again', url: SHOT }], 'a-page'), page([{ title: 'Log', url: 'https://uploads.linear.app/org/log.txt' }])],
        comments: [page([{ id: 'c-1', body: `Again ![shot](${SHOT}), [note.txt](${NOTE})`, createdAt: '2026-11-02T10:00:00Z', user: null, botActor: null, parent: null }])],
      },
      { [SHOT]: png },
    )
    const files = await importing.files('uuid-ENG-7')
    expect(files.map(({ key, name, type, size }) => ({ key, name, type, size }))).toEqual([
      { key: SHOT, name: 'shot', type: '', size: null },
      { key: 'https://uploads.linear.app/org/log.txt', name: 'Log', type: '', size: null },
      { key: NOTE, name: 'note.txt', type: '', size: null },
    ])
    expect(await files[0]!.read()).toEqual(new Uint8Array([137, 80, 78, 71]))
    expect(files[0]).toMatchObject({ type: 'image/png', size: 4 })
    expect(await files[2]!.read()).toEqual({ gone: 'the upload got HTTP 404' })
    expect(requests).toEqual([SHOT, NOTE])
    expect(calls.filter((call) => call.query.includes('attachments(')).map((call) => call.variables)).toEqual([
      { id: 'uuid-ENG-7', after: null },
      { id: 'uuid-ENG-7', after: 'a-page' },
    ])
    await importing.comments('uuid-ENG-7')
    expect(calls.filter((call) => call.query.includes('comments('))).toHaveLength(1)
  })

  it('reads the change log from the history, each field of an entry a change', async () => {
    const at = (minute: number) => `2026-11-01T10:${String(minute).padStart(2, '0')}:00Z`
    const none = {
      fromState: null, toState: null, fromTitle: null, toTitle: null, fromPriority: null, toPriority: null,
      fromEstimate: null, toEstimate: null, fromParent: null, toParent: null, addedLabels: null, removedLabels: null,
    }
    const { importing, calls } = await connect({
      estimation: 'exponential',
      issues: [page([issueNode(2)])],
      history: [
        page([
          { ...none, createdAt: at(3), actor: user('u-other', 'Jane Roe'), fromTitle: 'Old', toTitle: 'New', fromPriority: 0, toPriority: 2 },
          { ...none, createdAt: at(1), actor: user('u-agent', 'John Doe'), toState: { name: 'Backlog' } },
          { ...none, createdAt: at(2), actor: user('u-agent', 'John Doe'), fromState: { name: 'Backlog' }, toState: { name: 'Todo' }, addedLabels: [{ name: 'bug' }] },
        ], 'h-page'),
        page([
          { ...none, createdAt: at(4), actor: null, fromEstimate: null, toEstimate: 2, toParent: ref(1) },
          { ...none, createdAt: at(5), actor: null, fromEstimate: 2, toEstimate: 2, fromParent: ref(1), removedLabels: [{ name: 'bug' }] },
        ]),
      ],
    })
    const agent = { kind: 'agent', name: 'John Doe' }
    const other = { kind: 'person', name: 'Jane Roe' }
    expect(await importing.changes!('uuid-ENG-2')).toEqual([
      { at: Date.parse(at(2)), author: agent, field: 'status', from: 'Backlog', to: 'Todo' },
      { at: Date.parse(at(2)), author: agent, field: 'label', from: null, to: 'bug' },
      { at: Date.parse(at(3)), author: other, field: 'title', from: 'Old', to: 'New' },
      { at: Date.parse(at(3)), author: other, field: 'priority', from: null, to: 'high' },
      { at: Date.parse(at(4)), author: null, field: 'estimate', from: null, to: '10' },
      { at: Date.parse(at(4)), author: null, field: 'parent', from: null, to: 'ENG-1' },
      { at: Date.parse(at(5)), author: null, field: 'parent', from: 'ENG-1', to: null },
      { at: Date.parse(at(5)), author: null, field: 'label', from: 'bug', to: null },
    ])
    expect(calls.filter((call) => call.query.includes('history(')).map((call) => call.variables)).toEqual([
      { id: 'uuid-ENG-2', after: null },
      { id: 'uuid-ENG-2', after: 'h-page' },
    ])
  })

  it('fails a team the key cannot read issues of', async () => {
    const { importing } = await connect({ issues: [null] })
    await expect(importing.tasks()).rejects.toThrow(/ENG not found/)
  })
})
