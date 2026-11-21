import { describe, expect, it } from 'vitest'
import { connectGithub } from './source.js'

const PROJECTS = { ABC: { key: 'ABC', value: 'octo-org/abc' }, WEB: { key: 'WEB', value: 'octo-org/web' } }
const ASSET_ID = 'b24027f6-4820-4f55-9258-d80d7b7ca8d0'
const ASSET = `https://github.com/user-attachments/assets/${ASSET_ID}`
const PDF = 'https://github.com/user-attachments/files/123/report.pdf'

const page = (nodes: unknown[], endCursor: string | null = null) => ({ pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes })
const ref = (number: number, repo = 'octo-org/abc') => ({ id: `I_${repo}_${number}`, number, repository: { nameWithOwner: repo } })
const login = (name: string | null) => (name === null ? null : { login: name })

function issueNode(number: number, fields: Record<string, unknown> = {}) {
  return {
    ...ref(number),
    title: `Issue ${number}`,
    body: '',
    state: 'OPEN',
    stateReason: null,
    createdAt: '2026-11-01T10:00:00Z',
    closedAt: null,
    author: login('octocat'),
    parent: null,
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
    labels: { nodes: [] },
    milestone: null,
    ...fields,
  }
}

interface Graphql {
  query: string
  variables: Record<string, unknown>
}

/** GraphQL answered by what the query reads, page by page; anything else by URL. */
async function connect(answers: { issues?: unknown[]; comments?: unknown[]; events?: unknown[]; owner?: string }, routes: Record<string, () => Response> = {}) {
  const calls: Graphql[] = []
  const requests: string[] = []
  const queue = { issues: [...(answers.issues ?? [])], comments: [...(answers.comments ?? [])], events: [...(answers.events ?? [])] }
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (url !== 'https://api.github.com/graphql') {
      requests.push(url)
      return routes[url]?.() ?? new Response('Not Found', { status: 404 })
    }
    const call = JSON.parse(String(init?.body)) as Graphql
    calls.push(call)
    if (call.query.includes('viewer')) return Response.json({ data: { viewer: { login: 'octocat' } } })
    const owner = { __typename: answers.owner ?? 'User', login: 'jdoe' }
    if (call.query.includes('issues(')) return Response.json({ data: { repository: { owner, issues: queue.issues.shift() } } })
    if (call.query.includes('comments(')) return Response.json({ data: { node: { comments: queue.comments.shift() } } })
    if (call.query.includes('timelineItems(')) return Response.json({ data: { node: { timelineItems: queue.events.shift() } } })
    throw new Error(`unexpected query: ${call.query}`)
  }
  const source = await connectGithub({ token: 'github_pat_example', projects: PROJECTS }, 5_000, fetch as typeof globalThis.fetch, () => {})
  return { importing: await source.importSource!('ABC'), calls, requests }
}

describe('github import', () => {
  it('reads every issue of the repository, closed ones too, page by page, with its fields and links', async () => {
    const { importing, calls } = await connect({
      issues: [
        page([
          issueNode(2, {
            title: 'Second',
            body: `See ![shot](${ASSET})`,
            state: 'CLOSED',
            stateReason: 'NOT_PLANNED',
            closedAt: '2026-11-03T12:00:00Z',
            updatedAt: '2026-11-05T08:00:00Z',
            author: login('jdoe'),
            parent: ref(1),
            blockedBy: { nodes: [ref(1), ref(9, 'other/repo')] },
            labels: { nodes: [{ name: 'bug' }, { name: 'priority: high' }] },
            milestone: { title: 'v1.0' },
          }),
        ], 'cursor-1'),
        page([issueNode(1, { blocking: { nodes: [ref(2)] }, author: login('someone'), parent: ref(4, 'octo-org/web') })]),
      ],
    })
    const tasks = await importing.tasks()
    expect(tasks.map((task) => task.id)).toEqual(['ABC-1', 'ABC-2'])
    expect(tasks[1]).toEqual({
      ref: 'I_octo-org/abc_2',
      number: 2,
      id: 'ABC-2',
      title: 'Second',
      description: `See ![shot](${ASSET})`,
      images: [{ ref: ASSET, file: ASSET_ID }],
      status: { name: 'Not planned', category: 'Lost' },
      priority: 'high',
      milestone: 'v1.0',
      component: null,
      labels: ['bug'],
      estimate: null,
      parent: { ref: 'I_octo-org/abc_1', id: 'ABC-1', foreign: false },
      blocks: [],
      blockedBy: [
        { ref: 'I_octo-org/abc_1', id: 'ABC-1', foreign: false },
        { ref: 'I_other/repo_9', id: 'other/repo#9', foreign: true },
      ],
      related: [],
      createdAt: Date.parse('2026-11-01T10:00:00Z'),
      createdBy: { kind: 'user', name: 'jdoe' },
      closedAt: Date.parse('2026-11-03T12:00:00Z'),
      modifiedAt: Date.parse('2026-11-05T08:00:00Z'),
    })
    expect(tasks[0]).toMatchObject({
      status: { name: 'Open', category: 'ToDo' },
      priority: 'none',
      closedAt: null,
      blocks: [{ ref: 'I_octo-org/abc_2', id: 'ABC-2', foreign: false }],
      parent: { id: 'WEB-4', foreign: true },
      createdBy: { kind: 'person', name: 'someone' },
    })
    const reads = calls.filter((call) => call.query.includes('issues('))
    expect(reads.map((call) => call.variables)).toEqual([
      { owner: 'octo-org', name: 'abc', after: null },
      { owner: 'octo-org', name: 'abc', after: 'cursor-1' },
    ])
    expect(reads[0]!.query).not.toMatch(/pullRequests|states:/)
    await importing.tasks()
    expect(calls.filter((call) => call.query.includes('issues('))).toHaveLength(2)
  })

  it('takes the token for the agent, and no user in an organisation', async () => {
    const { importing } = await connect({ owner: 'Organization', issues: [page([issueNode(1), issueNode(2, { author: login('jdoe') }), issueNode(3, { author: null })])] })
    expect((await importing.tasks()).map((task) => task.createdBy)).toEqual([{ kind: 'agent', name: 'octocat' }, { kind: 'person', name: 'jdoe' }, null])
  })

  it('reads the comments oldest first, every upload in them a file at its place', async () => {
    const { importing, calls } = await connect({
      issues: [page([issueNode(1)])],
      comments: [
        page([{ id: 'IC_2', body: `Report: [report.pdf](${PDF})\n<img alt="Image" src="${ASSET}" />`, createdAt: '2026-11-02T10:00:00Z', author: login('octocat') }], 'c-1'),
        page([{ id: 'IC_1', body: 'First', createdAt: '2026-11-01T11:00:00Z', author: login('jdoe') }]),
      ],
    })
    await importing.tasks()
    expect(await importing.comments('I_octo-org/abc_1')).toEqual([
      { ref: 'IC_1', author: { kind: 'user', name: 'jdoe' }, at: Date.parse('2026-11-01T11:00:00Z'), body: 'First', images: [], files: [], replyTo: null },
      {
        ref: 'IC_2',
        author: { kind: 'agent', name: 'octocat' },
        at: Date.parse('2026-11-02T10:00:00Z'),
        body: `Report: [report.pdf](${PDF})\n<img alt="Image" src="${ASSET}" />`,
        images: [{ ref: PDF, file: PDF }, { ref: ASSET, file: ASSET_ID }],
        files: [PDF, ASSET_ID],
        replyTo: null,
      },
    ])
    expect(calls.filter((call) => call.query.includes('comments(')).map((call) => call.variables)).toEqual([
      { id: 'I_octo-org/abc_1', after: null },
      { id: 'I_octo-org/abc_1', after: 'c-1' },
    ])
  })

  it('gives each upload of the description and the comments once and downloads it with the token', async () => {
    const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png', 'content-length': '4' } })
    const { importing, calls, requests } = await connect(
      {
        issues: [page([issueNode(7, { body: `![shot](${ASSET}) and https://example.com/outside.png` })])],
        comments: [page([{ id: 'IC_1', body: `Again ![shot](${ASSET}), [report.pdf](${PDF})`, createdAt: '2026-11-02T10:00:00Z', author: null }])],
      },
      { [ASSET]: png },
    )
    const files = await importing.files('I_octo-org/abc_7')
    expect(files.map(({ key, name, type, size }) => ({ key, name, type, size }))).toEqual([
      { key: ASSET_ID, name: 'shot', type: '', size: null },
      { key: PDF, name: 'report.pdf', type: '', size: null },
    ])
    expect(await files[0]!.read()).toEqual(new Uint8Array([137, 80, 78, 71]))
    expect(files[0]).toMatchObject({ type: 'image/png', size: 4 })
    expect(requests).toEqual([ASSET])
    await importing.comments('I_octo-org/abc_7')
    expect(calls.filter((call) => call.query.includes('comments('))).toHaveLength(1)
  })

  it('gives no bytes of an upload GitHub serves no more', async () => {
    const { importing } = await connect({ issues: [page([issueNode(7, { body: `[report.pdf](${PDF})` })])], comments: [page([])] })
    const [file] = await importing.files('I_octo-org/abc_7')
    expect(await file!.read()).toBeNull()
  })

  it('reads the change log from the timeline, a priority label as the priority', async () => {
    const at = (minute: number) => `2026-11-01T10:${String(minute).padStart(2, '0')}:00Z`
    const { importing, calls } = await connect({
      issues: [page([issueNode(2)])],
      events: [
        page([
          { __typename: 'LabeledEvent', createdAt: at(1), actor: login('jdoe'), label: { name: 'bug' } },
          { __typename: 'LabeledEvent', createdAt: at(2), actor: login('jdoe'), label: { name: 'priority: high' } },
          { __typename: 'MilestonedEvent', createdAt: at(3), actor: login('jdoe'), milestoneTitle: 'v1.0' },
          { __typename: 'RenamedTitleEvent', createdAt: at(4), actor: login('octocat'), previousTitle: 'Old', currentTitle: 'New' },
        ], 'e-1'),
        page([
          { __typename: 'ParentIssueAddedEvent', createdAt: at(5), actor: login('octocat'), parent: ref(1) },
          { __typename: 'ClosedEvent', createdAt: at(7), actor: login('octocat'), stateReason: 'COMPLETED' },
          { __typename: 'ReopenedEvent', createdAt: at(8), actor: null },
          { __typename: 'UnlabeledEvent', createdAt: at(9), actor: login('someone'), label: { name: 'priority: high' } },
          { __typename: 'UnlabeledEvent', createdAt: at(10), actor: login('someone'), label: { name: 'bug' } },
          { __typename: 'DemilestonedEvent', createdAt: at(11), actor: login('someone'), milestoneTitle: 'v1.0' },
          { __typename: 'ParentIssueRemovedEvent', createdAt: at(12), actor: login('someone'), parent: ref(1) },
          { __typename: 'ClosedEvent', createdAt: at(6), actor: login('octocat'), stateReason: 'DUPLICATE' },
        ]),
      ],
    })
    const jdoe = { kind: 'user', name: 'jdoe' }
    const agent = { kind: 'agent', name: 'octocat' }
    const someone = { kind: 'person', name: 'someone' }
    expect(await importing.changes!('I_octo-org/abc_2')).toEqual([
      { at: Date.parse(at(1)), author: jdoe, field: 'label', from: null, to: 'bug' },
      { at: Date.parse(at(2)), author: jdoe, field: 'priority', from: null, to: 'high' },
      { at: Date.parse(at(3)), author: jdoe, field: 'milestone', from: null, to: 'v1.0' },
      { at: Date.parse(at(4)), author: agent, field: 'title', from: 'Old', to: 'New' },
      { at: Date.parse(at(5)), author: agent, field: 'parent', from: null, to: 'ABC-1' },
      { at: Date.parse(at(6)), author: agent, field: 'status', from: 'Open', to: 'Duplicate' },
      { at: Date.parse(at(7)), author: agent, field: 'status', from: 'Duplicate', to: 'Completed' },
      { at: Date.parse(at(8)), author: null, field: 'status', from: 'Completed', to: 'Open' },
      { at: Date.parse(at(9)), author: someone, field: 'priority', from: 'high', to: null },
      { at: Date.parse(at(10)), author: someone, field: 'label', from: 'bug', to: null },
      { at: Date.parse(at(11)), author: someone, field: 'milestone', from: 'v1.0', to: null },
      { at: Date.parse(at(12)), author: someone, field: 'parent', from: 'ABC-1', to: null },
    ])
    const reads = calls.filter((call) => call.query.includes('timelineItems('))
    expect(reads.map((call) => call.variables)).toEqual([
      { id: 'I_octo-org/abc_2', after: null },
      { id: 'I_octo-org/abc_2', after: 'e-1' },
    ])
  })

  it('fails a repository the token cannot see', async () => {
    const { importing } = await connect({ issues: [null] })
    await expect(importing.tasks()).rejects.toThrow(/octo-org\/abc not found/)
  })
})
