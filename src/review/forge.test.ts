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

  it('gives the reviews asking for changes with their comments', async () => {
    const { forge: pulls } = forge({
      'GET /pulls/12/reviews?per_page=100': [
        { id: 1, user: { login: 'jdoe' }, body: 'Fine', state: 'APPROVED', submitted_at: '2026-10-18T10:00:00Z' },
        { id: 2, user: { login: 'jdoe' }, body: 'Rename it', state: 'CHANGES_REQUESTED', submitted_at: '2026-10-18T11:00:00Z' },
        { id: 3, user: { login: 'jdoe' }, body: 'Old', state: 'CHANGES_REQUESTED', submitted_at: '2026-10-18T09:00:00Z' },
      ],
      'GET /pulls/12/reviews/2/comments?per_page=100': [{ path: 'src/a.ts', line: 4, body: 'here' }, { path: 'src/b.ts', line: null, original_line: 9, body: 'and here' }],
    })
    expect(await pulls.changes(12, (_, at) => at > '2026-10-18T10:00:00Z')).toEqual([
      {
        id: '2',
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

  it('says a refused write needs the right to write pull requests', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch
    const pulls = githubPulls({ owner: 'octo-org', repo: 'app', token: 'fake-token' }, 1_000, fetchImpl)
    await expect(pulls.create({ branch: 'b', base: 'main', title: 't', body: '' })).rejects.toMatchObject({ notice: { code: 'review.denied' } })
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

  it('gives the reviews asking for changes, not the dismissed ones', async () => {
    const { forge: pulls } = forge({
      'GET /pulls/5/reviews?page=1&limit=50': [
        { id: 7, user: { login: 'jdoe' }, body: 'Rename it', state: 'REQUEST_CHANGES', submitted_at: '2026-10-18T11:00:00Z' },
        { id: 8, user: { login: 'jdoe' }, body: 'Gone', state: 'REQUEST_CHANGES', submitted_at: '2026-10-18T11:00:00Z', dismissed: true },
        { id: 9, user: { login: 'jdoe' }, body: '', state: 'COMMENT', submitted_at: '2026-10-18T11:00:00Z' },
      ],
      'GET /pulls/5/reviews/7/comments': [{ path: 'src/a.ts', position: 0, original_position: 3, body: 'here' }],
    })
    expect(await pulls.changes(5, all)).toEqual([
      { id: '7', author: 'jdoe', body: 'Rename it', at: '2026-10-18T11:00:00Z', comments: [{ path: 'src/a.ts', line: 3, body: 'here' }] },
    ])
  })
})
