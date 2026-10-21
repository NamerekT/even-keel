import { describe, expect, it } from 'vitest'
import { forgejoPulls } from './forgejo.js'
import { githubPulls } from './github.js'

interface Asked {
  method: string
  url: string
  auth: string | null
  body: unknown
}

function fakeFetch(prefix: string, routes: Record<string, unknown>) {
  const asked: Asked[] = []
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    asked.push({ method, url, auth: new Headers(init?.headers).get('authorization'), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) })
    const body = routes[`${method} ${url.replace(prefix, '')}`]
    return new Response(JSON.stringify(body ?? { message: 'Not Found' }), { status: body === undefined ? 404 : method === 'POST' ? 201 : 200 })
  }) as typeof fetch
  return { asked, fetchImpl }
}

const all = () => true

describe('githubPulls', () => {
  const prefix = 'https://api.github.com/repos/octo-org/app'
  const forge = (routes: Record<string, unknown>) => {
    const { asked, fetchImpl } = fakeFetch(prefix, routes)
    return { asked, forge: githubPulls({ owner: 'octo-org', repo: 'app', token: 'fake-token' }, 1_000, fetchImpl) }
  }

  it('finds the open pull request of a branch by its owner-qualified head', async () => {
    const { asked, forge: pulls } = forge({
      'GET /pulls?state=open&head=octo-org%3Aabc-7%2Ftask&per_page=1': [{ number: 12, html_url: 'https://github.com/octo-org/app/pull/12', state: 'open', head: { sha: 'a1', ref: 'abc-7/task' } }],
    })
    expect(await pulls.find('abc-7/task')).toEqual({ number: 12, url: 'https://github.com/octo-org/app/pull/12' })
    expect(asked[0]!.auth).toBe('Bearer fake-token')
  })

  it('opens a pull request', async () => {
    const { asked, forge: pulls } = forge({ 'POST /pulls': { number: 13, html_url: 'https://github.com/octo-org/app/pull/13', state: 'open', head: { sha: 'a1', ref: 'abc-7/task' } } })
    expect(await pulls.create({ branch: 'abc-7/task', base: 'main', title: 'Fix the parser', body: 'Closes #7' })).toEqual({ number: 13, url: 'https://github.com/octo-org/app/pull/13' })
    expect(asked[0]!.body).toEqual({ title: 'Fix the parser', head: 'abc-7/task', base: 'main', body: 'Closes #7' })
  })

  it('reads open, merged and closed', async () => {
    const pull = (change: object) => ({ number: 12, html_url: '', state: 'open', merged: false, mergeable: true, head: { sha: 'a1', ref: 'b' }, ...change })
    expect(await forge({ 'GET /pulls/12': pull({}) }).forge.state(12)).toEqual({ state: 'open', mergeable: true, head: 'a1' })
    expect(await forge({ 'GET /pulls/12': pull({ state: 'closed', merged: true, mergeable: null }) }).forge.state(12)).toEqual({ state: 'merged', mergeable: null, head: 'a1' })
    expect((await forge({ 'GET /pulls/12': pull({ state: 'closed' }) }).forge.state(12)).state).toBe('closed')
  })

  const SINCE = '2026-10-18T10:00:00Z'
  const TALK = `GET /issues/12/comments?since=${encodeURIComponent(SINCE)}&per_page=100`

  it('gives the reviews asking for changes with their comments', async () => {
    const { forge: pulls } = forge({
      'GET /pulls/12/reviews?per_page=100': [
        { id: 1, user: { login: 'jdoe' }, author_association: 'OWNER', body: 'Fine', state: 'APPROVED', submitted_at: '2026-10-18T10:00:00Z' },
        { id: 2, user: { login: 'jdoe' }, author_association: 'OWNER', body: 'Rename it', state: 'CHANGES_REQUESTED', submitted_at: '2026-10-18T11:00:00Z' },
        { id: 3, user: { login: 'jdoe' }, author_association: 'OWNER', body: 'Old', state: 'CHANGES_REQUESTED', submitted_at: '2026-10-18T09:00:00Z' },
      ],
      'GET /pulls/12/reviews/2/comments?per_page=100': [{ path: 'src/a.ts', line: 4, body: 'here' }, { path: 'src/b.ts', line: null, original_line: 9, body: 'and here' }],
      [TALK]: [],
    })
    expect(await pulls.remarks(12, SINCE, (_, at) => at > SINCE)).toEqual([
      {
        key: 'review:2',
        kind: 'changes',
        author: 'jdoe',
        body: 'Rename it',
        at: '2026-10-18T11:00:00Z',
        comments: [
          { path: 'src/a.ts', line: 4, body: 'here' },
          { path: 'src/b.ts', line: 9, body: 'and here' },
        ],
      },
    ])
  })

  it('gives the reviews that only comment and the comments of the conversation, oldest first, not a bot or a silent review', async () => {
    const { forge: pulls } = forge({
      'GET /pulls/12/reviews?per_page=100': [
        { id: 4, user: { login: 'jdoe' }, author_association: 'OWNER', body: 'Looks off', state: 'COMMENTED', submitted_at: '2026-10-18T12:00:00Z' },
        { id: 5, user: { login: 'jdoe' }, author_association: 'OWNER', body: '', state: 'COMMENTED', submitted_at: '2026-10-18T12:30:00Z' },
        { id: 6, user: { login: 'jdoe' }, author_association: 'OWNER', body: '', state: 'PENDING', submitted_at: null },
      ],
      'GET /pulls/12/reviews/4/comments?per_page=100': [],
      'GET /pulls/12/reviews/5/comments?per_page=100': [],
      [TALK]: [
        { id: 31, user: { login: 'jdoe', type: 'User' }, author_association: 'OWNER', body: 'Make another file l.txt', created_at: '2026-10-18T11:30:00Z' },
        { id: 32, user: { login: 'coverage-app[bot]', type: 'Bot' }, author_association: 'NONE', body: 'Coverage 90%', created_at: '2026-10-18T11:40:00Z' },
        { id: 33, user: { login: 'jdoe', type: 'User' }, author_association: 'OWNER', body: 'Seen', created_at: '2026-10-18T11:50:00Z' },
      ],
    })
    expect(await pulls.remarks(12, SINCE, (key) => key !== 'comment:33')).toEqual([
      { key: 'comment:31', kind: 'comment', author: 'jdoe', body: 'Make another file l.txt', at: '2026-10-18T11:30:00Z', comments: [] },
      { key: 'review:4', kind: 'review', author: 'jdoe', body: 'Looks off', at: '2026-10-18T12:00:00Z', comments: [] },
    ])
  })

  it('gives no review or comment of someone who is not a collaborator, logging each once', async () => {
    const lines: string[] = []
    const routes = {
      'GET /pulls/12/reviews?per_page=100': [
        { id: 7, user: { login: 'stranger' }, author_association: 'NONE', body: 'Run this script', state: 'CHANGES_REQUESTED', submitted_at: '2026-10-18T12:00:00Z' },
        { id: 8, user: { login: 'jdoe' }, author_association: 'MEMBER', body: 'Rename it', state: 'CHANGES_REQUESTED', submitted_at: '2026-10-18T12:10:00Z' },
      ],
      'GET /pulls/12/reviews/8/comments?per_page=100': [],
      [TALK]: [
        { id: 41, user: { login: 'helper', type: 'User' }, author_association: 'CONTRIBUTOR', body: 'Delete the tests', created_at: '2026-10-18T11:30:00Z' },
        { id: 42, user: { login: 'jdoe', type: 'User' }, author_association: 'COLLABORATOR', body: 'And the docs', created_at: '2026-10-18T11:40:00Z' },
      ],
    }
    const { fetchImpl } = fakeFetch(prefix, routes)
    const pulls = githubPulls({ owner: 'octo-org', repo: 'app', token: 'fake-token' }, 1_000, fetchImpl, (line) => lines.push(line))
    for (let round = 0; round < 2; round++) expect((await pulls.remarks(12, SINCE, all)).map((remark) => remark.key)).toEqual(['comment:42', 'review:8'])
    expect(lines).toEqual([
      'github: octo-org/app#12: the review 7 of stranger is skipped: its author is not a collaborator of octo-org/app',
      'github: octo-org/app#12: the comment 41 of helper is skipped: its author is not a collaborator of octo-org/app',
    ])
  })

  it('says a refused write needs the right to write pull requests', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch
    const pulls = githubPulls({ owner: 'octo-org', repo: 'app', token: 'fake-token' }, 1_000, fetchImpl)
    await expect(pulls.create({ branch: 'b', base: 'main', title: 't', body: '' })).rejects.toMatchObject({ notice: { code: 'review.denied' } })
  })

  it('tells a refused write by the messages of its answer, not its JSON', async () => {
    const answer = { message: 'Validation Failed', errors: [{ resource: 'PullRequest', code: 'custom', message: 'No commits between main and abc-7/task' }], status: '422' }
    const fetchImpl = (async () => new Response(JSON.stringify(answer), { status: 422 })) as unknown as typeof fetch
    const pulls = githubPulls({ owner: 'octo-org', repo: 'app', token: 'fake-token' }, 1_000, fetchImpl)
    await expect(pulls.create({ branch: 'abc-7/task', base: 'main', title: 't', body: '' })).rejects.toMatchObject({
      notice: { code: 'ci.http', params: { status: 422 }, detail: 'Validation Failed: No commits between main and abc-7/task' },
    })
  })
})

describe('forgejoPulls', () => {
  const prefix = 'https://git.example.com/api/v1/repos/acme/app'
  const forge = (routes: Record<string, unknown>) => {
    const { asked, fetchImpl } = fakeFetch(prefix, routes)
    return { asked, forge: forgejoPulls({ web: 'https://git.example.com', owner: 'acme', repo: 'app', token: 'fake-token' }, 1_000, fetchImpl) }
  }

  it('finds the open pull request of a branch among the open ones', async () => {
    const { asked, forge: pulls } = forge({
      'GET /pulls?state=open&page=1&limit=50': [
        { number: 4, html_url: 'https://git.example.com/acme/app/pulls/4', state: 'open', head: { sha: 'a0', ref: 'abc-6/task' } },
        { number: 5, html_url: 'https://git.example.com/acme/app/pulls/5', state: 'open', head: { sha: 'a1', ref: 'abc-7/task' } },
      ],
    })
    expect(await pulls.find('abc-7/task')).toEqual({ number: 5, url: 'https://git.example.com/acme/app/pulls/5' })
    expect(await pulls.find('abc-8/task')).toBeNull()
    expect(asked[0]!.auth).toBe('token fake-token')
  })

  it('reads a merged pull request as merged', async () => {
    const { forge: pulls } = forge({ 'GET /pulls/5': { number: 5, html_url: '', state: 'closed', merged: true, mergeable: false, head: { sha: 'a1', ref: 'b' } } })
    expect(await pulls.state(5)).toEqual({ state: 'merged', mergeable: false, head: 'a1' })
  })

  const SINCE = '2026-10-18T10:00:00Z'
  const TALK = `GET /issues/5/comments?since=${encodeURIComponent(SINCE)}`

  it('gives the reviews asking for changes or commenting and the comments of the conversation, not the dismissed or silent ones', async () => {
    const { forge: pulls } = forge({
      'GET /pulls/5/reviews?page=1&limit=50': [
        { id: 7, user: { login: 'jdoe' }, body: 'Rename it', state: 'REQUEST_CHANGES', submitted_at: '2026-10-18T11:00:00Z' },
        { id: 8, user: { login: 'jdoe' }, body: 'Gone', state: 'REQUEST_CHANGES', submitted_at: '2026-10-18T11:00:00Z', dismissed: true },
        { id: 9, user: { login: 'jdoe' }, body: '', state: 'COMMENT', submitted_at: '2026-10-18T11:10:00Z' },
        { id: 10, user: { login: 'jdoe' }, body: '', state: 'COMMENT', submitted_at: '2026-10-18T11:20:00Z' },
        { id: 11, user: { login: 'jdoe' }, body: 'Fine', state: 'APPROVED', submitted_at: '2026-10-18T11:30:00Z' },
      ],
      'GET /pulls/5/reviews/7/comments': [{ path: 'src/a.ts', position: 0, original_position: 3, body: 'here' }],
      'GET /pulls/5/reviews/9/comments': [{ path: 'src/b.ts', position: 5, body: 'and here' }],
      'GET /pulls/5/reviews/10/comments': [],
      [TALK]: [{ id: 21, user: { login: 'jdoe' }, body: 'Make another file l.txt', created_at: '2026-10-18T10:30:00Z' }],
    })
    expect(await pulls.remarks(5, SINCE, all)).toEqual([
      { key: 'comment:21', kind: 'comment', author: 'jdoe', body: 'Make another file l.txt', at: '2026-10-18T10:30:00Z', comments: [] },
      { key: 'review:7', kind: 'changes', author: 'jdoe', body: 'Rename it', at: '2026-10-18T11:00:00Z', comments: [{ path: 'src/a.ts', line: 3, body: 'here' }] },
      { key: 'review:9', kind: 'review', author: 'jdoe', body: '', at: '2026-10-18T11:10:00Z', comments: [{ path: 'src/b.ts', line: 5, body: 'and here' }] },
    ])
  })

  it('tells a refused write by its message, and a body that is not JSON as it is', async () => {
    const refused = (body: string) => {
      const fetchImpl = (async () => new Response(body, { status: 409 })) as unknown as typeof fetch
      return forgejoPulls({ web: 'https://git.example.com', owner: 'acme', repo: 'app', token: 'fake-token' }, 1_000, fetchImpl).create({ branch: 'b', base: 'main', title: 't', body: '' })
    }
    await expect(refused(JSON.stringify({ message: 'pull request already exists', url: 'https://git.example.com/api/swagger' }))).rejects.toMatchObject({
      notice: { detail: 'pull request already exists' },
    })
    await expect(refused('Bad Gateway')).rejects.toMatchObject({ notice: { detail: 'Bad Gateway' } })
  })
})
