import { describe, expect, it } from 'vitest'
import { connectGithub } from '../github/source.js'
import { hulyImport } from '../huly/import.js'
import { connectLinear } from '../linear/source.js'
import type { ImportFile } from './import.js'

/**
 * The contract of `ImportFile.read` held for every import adapter (BTN-1458): a file the tracker surely has no more is
 * `{ gone }`, anything else that gives no bytes throws and stops the import. A new import adapter adds its row to
 * `ADAPTERS`, answering each case the way its tracker does.
 */
type Answer = 'served' | 'missing' | 'removed' | 'refused' | 'unauthorized' | 'limited' | 'failing' | 'network'

const BYTES = new Uint8Array([137, 80, 78, 71])
const STATUS: Record<Exclude<Answer, 'network'>, number> = { served: 200, missing: 404, removed: 410, refused: 403, unauthorized: 401, limited: 429, failing: 500 }

/** Any request off the tracker's API answered as the case says. */
function answer(what: Answer): Response {
  if (what === 'network') throw new TypeError('fetch failed')
  if (what === 'served') return new Response(BYTES, { headers: { 'content-type': 'image/png', 'content-length': '4' } })
  return new Response('', { status: STATUS[what] })
}

const page = (nodes: unknown[]) => ({ pageInfo: { hasNextPage: false, endCursor: null }, nodes })

async function githubFile(what: Answer): Promise<ImportFile> {
  const asset = 'https://github.com/user-attachments/assets/b24027f6-4820-4f55-9258-d80d7b7ca8d0'
  const issue = {
    id: 'I_7', number: 7, repository: { nameWithOwner: 'octo-org/abc' }, title: 'Issue 7', body: `![shot](${asset})`, state: 'OPEN', stateReason: null,
    createdAt: '2026-11-01T10:00:00Z', closedAt: null, author: { login: 'octocat' }, parent: null, blockedBy: { nodes: [] }, blocking: { nodes: [] }, labels: { nodes: [] }, milestone: null,
  }
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(input) !== 'https://api.github.com/graphql') return answer(what)
    const { query } = JSON.parse(String(init?.body)) as { query: string }
    if (query.includes('viewer')) return Response.json({ data: { viewer: { login: 'octocat' } } })
    if (query.includes('issues(')) return Response.json({ data: { repository: { owner: { __typename: 'User', login: 'jdoe' }, issues: page([issue]) } } })
    if (query.includes('comments(')) return Response.json({ data: { node: { comments: page([]) } } })
    throw new Error(`unexpected query: ${query}`)
  }
  const source = await connectGithub({ token: 'github_pat_example', projects: { ABC: { key: 'ABC', value: 'octo-org/abc' } } }, 5_000, fetch as typeof globalThis.fetch, () => {})
  return (await (await source.importSource!('ABC')).files('I_7'))[0]!
}

async function linearFile(what: Answer): Promise<ImportFile> {
  const issue = {
    id: 'uuid-7', identifier: 'ENG-7', number: 7, title: 'Issue 7', description: '![shot](https://uploads.linear.app/org/shot.png)', priority: 0, estimate: null, trashed: null,
    createdAt: '2026-11-01T10:00:00Z', completedAt: null, canceledAt: null, state: { name: 'Todo', type: 'unstarted' }, creator: { id: 'u-agent', name: 'John Doe' }, parent: null,
    relations: { nodes: [] }, inverseRelations: { nodes: [] }, labels: { nodes: [] }, projectMilestone: null,
  }
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(input) !== 'https://api.linear.app/graphql') return answer(what)
    const { query } = JSON.parse(String(init?.body)) as { query: string }
    if (query.includes('organization {')) return Response.json({ data: { organization: { urlKey: 'example' } } })
    if (query.includes('viewer {')) return Response.json({ data: { viewer: { id: 'u-agent' } } })
    if (query.includes('team(id:')) return Response.json({ data: { team: { id: 't-eng', issueEstimationType: 'notUsed', states: { nodes: [] }, projects: { nodes: [] } } } })
    if (query.includes('issues(')) return Response.json({ data: { issues: page([issue]) } })
    if (query.includes('comments(')) return Response.json({ data: { issue: { comments: page([]) } } })
    if (query.includes('attachments(')) return Response.json({ data: { issue: { attachments: page([]) } } })
    throw new Error(`unexpected query: ${query}`)
  }
  const source = await connectLinear({ token: 'lin_api_example', projects: { 'id-eng': { key: 'ENG', value: '' } } }, 5_000, fetch as typeof globalThis.fetch)
  return (await (await source.importSource!('id-eng')).files('uuid-7'))[0]!
}

/** Huly's storage is no HTTP of ours: a file it has not is its `NotFoundError`, the rest its other failures. */
async function hulyFile(what: Answer): Promise<ImportFile> {
  const source = hulyImport({
    client: {
      findAll: async <T>(cls: string) => (cls === 'attachment:class:Attachment' ? [{ attachedTo: 'id-7', file: 'blob-1', name: 'shot.png', type: 'image/png', size: 4, createdOn: 1, modifiedOn: 1 }] : []) as T[],
      fetchMarkup: async () => '',
    },
    markup: { markupToJSON: () => ({}), markupToMarkdown: () => '' },
    space: { _id: 'space' },
    ownSocialId: 'social-agent',
    readFile: async () => {
      if (what === 'missing' || what === 'removed') throw Object.assign(new Error('not found'), { name: 'NotFoundError' })
      if (what === 'network') throw new TypeError('fetch failed')
      if (what !== 'served') throw new Error(`HTTP ${STATUS[what]}`)
      return (async function* () {
        yield BYTES
      })()
    },
  })
  return (await source.files('id-7'))[0]!
}

const ADAPTERS: { name: string; file(what: Answer): Promise<ImportFile> }[] = [
  { name: 'github', file: githubFile },
  { name: 'linear', file: linearFile },
  { name: 'huly', file: hulyFile },
]

describe.each(ADAPTERS)('the import read of a $name attachment', ({ file }) => {
  it('gives the bytes it is served', async () => {
    expect(await (await file('served')).read()).toEqual(BYTES)
  })

  it.each(['missing', 'removed'] as const)('passes over a file that is %s, saying why', async (what) => {
    const got = await (await file(what)).read()
    expect(got).toEqual({ gone: expect.stringMatching(/\S/) })
  })

  it.each(['refused', 'unauthorized', 'limited', 'failing', 'network'] as const)('stops on a %s read', async (what) => {
    await expect((await file(what)).read()).rejects.toThrow()
  })
})
