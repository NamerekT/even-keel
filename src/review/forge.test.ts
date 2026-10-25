import { describe, expect, it } from 'vitest'
import { forgejoPulls } from './forgejo.js'
import { githubPulls } from './github.js'
import { gitlabPulls } from './gitlab.js'

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

describe('gitlabPulls', () => {
  const prefix = 'https://git.example.com/gitlab/api/v4/projects/group%2Fsub%2Fapp'
  const forge = (routes: Record<string, unknown>, log?: (line: string) => void) => {
    const { asked, fetchImpl } = fakeFetch(prefix, routes)
    return { asked, forge: gitlabPulls({ web: 'https://git.example.com/gitlab', owner: 'group/sub', repo: 'app', token: 'fake-token' }, 1_000, fetchImpl, log) }
  }
  const request = (change: object) => ({ iid: 9, web_url: 'https://git.example.com/gitlab/group/sub/app/-/merge_requests/9', state: 'opened', sha: 'a1', has_conflicts: false, detailed_merge_status: 'mergeable', ...change })

  it('finds the open merge request of a branch by its source branch', async () => {
    const { asked, forge: pulls } = forge({ 'GET /merge_requests?state=opened&source_branch=abc-7%2Ftask&per_page=1': [request({})] })
    expect(await pulls.find('abc-7/task')).toEqual({ number: 9, url: 'https://git.example.com/gitlab/group/sub/app/-/merge_requests/9' })
    expect(asked[0]!.auth).toBe('Bearer fake-token')
    expect(await forge({ 'GET /merge_requests?state=opened&source_branch=abc-8%2Ftask&per_page=1': [] }).forge.find('abc-8/task')).toBeNull()
  })

  it('opens a merge request into the base with the title and the description', async () => {
    const { asked, forge: pulls } = forge({ 'POST /merge_requests': request({}) })
    expect(await pulls.create({ branch: 'abc-7/task', base: 'trunk', title: 'Fix the parser', body: 'Closes #7' })).toEqual({ number: 9, url: request({}).web_url })
    expect(asked[0]!.body).toEqual({ source_branch: 'abc-7/task', target_branch: 'trunk', title: 'Fix the parser', description: 'Closes #7' })
  })

  it('reads opened and locked as open, merged, closed, and a conflict while the check is done or not', async () => {
    const state = (change: object) => forge({ 'GET /merge_requests/9': request(change) }).forge.state(9)
    expect(await state({})).toEqual({ state: 'open', mergeable: true, head: 'a1' })
    expect(await state({ state: 'locked', detailed_merge_status: 'checking' })).toEqual({ state: 'open', mergeable: null, head: 'a1' })
    expect(await state({ detailed_merge_status: 'conflict' })).toMatchObject({ mergeable: false })
    expect(await state({ has_conflicts: true, detailed_merge_status: 'unchecked' })).toMatchObject({ mergeable: false })
    expect(await state({ detailed_merge_status: 'not_approved' })).toMatchObject({ mergeable: true })
    expect(await state({ detailed_merge_status: undefined, merge_status: 'unchecked' })).toMatchObject({ mergeable: null })
    expect((await state({ state: 'merged' })).state).toBe('merged')
    expect((await state({ state: 'closed' })).state).toBe('closed')
  })

  const SINCE = '2026-10-18T10:00:00Z'
  const DISCUSSIONS = 'GET /merge_requests/9/discussions?per_page=100&page=1'
  const note = (id: number, change: object) => ({ id, type: null, body: 'Rename it', author: { id: 3, username: 'jdoe' }, created_at: '2026-10-18T11:00:00Z', system: false, ...change })

  it('gives the notes after the time, line notes with their place, and drops system notes, bots and empty ones', async () => {
    const lines: string[] = []
    const { forge: pulls } = forge(
      {
        [DISCUSSIONS]: [
          { id: 'd1', notes: [note(1, { created_at: '2026-10-18T09:00:00Z' })] },
          { id: 'd2', notes: [note(2, { body: 'approved this merge request', system: true })] },
          {
            id: 'd3',
            notes: [
              note(3, { type: 'DiffNote', body: 'here', position: { new_path: 'src/a.ts', new_line: 4, old_path: 'src/a.ts', old_line: 3 } }),
              note(4, { type: 'DiffNote', body: 'gone line', created_at: '2026-10-18T11:10:00Z', position: { new_path: null, new_line: null, old_path: 'src/b.ts', old_line: 8 } }),
            ],
          },
          { id: 'd4', notes: [note(5, { author: { id: 4, username: 'project_12_bot_0f3a', bot: true }, body: 'Coverage 90%' })] },
          { id: 'd5', notes: [note(6, { body: '  ', created_at: '2026-10-18T11:20:00Z' }), note(7, { body: 'Make l.txt', created_at: '2026-10-18T11:30:00Z' })] },
        ],
        'GET /members/all/3': { access_level: 30 },
      },
      (line) => lines.push(line),
    )
    expect(await pulls.remarks(9, SINCE, all)).toEqual([
      { key: 'note:3', kind: 'review', author: 'jdoe', body: '', at: '2026-10-18T11:00:00Z', comments: [{ path: 'src/a.ts', line: 4, body: 'here' }] },
      { key: 'note:4', kind: 'review', author: 'jdoe', body: '', at: '2026-10-18T11:10:00Z', comments: [{ path: 'src/b.ts', line: 8, body: 'gone line' }] },
      { key: 'note:7', kind: 'comment', author: 'jdoe', body: 'Make l.txt', at: '2026-10-18T11:30:00Z', comments: [] },
    ])
    expect(lines).toEqual([])
  })

  it('takes only what the wanted filter takes', async () => {
    const { forge: pulls } = forge({ [DISCUSSIONS]: [{ id: 'd1', notes: [note(1, {}), note(2, {})] }], 'GET /members/all/3': { access_level: 30 } })
    expect((await pulls.remarks(9, SINCE, (key) => key !== 'note:1')).map((remark) => remark.key)).toEqual(['note:2'])
  })

  it('skips, once in the log, the notes of an author below Reporter or not a member of the project', async () => {
    const lines: string[] = []
    const { asked, forge: pulls } = forge(
      {
        [DISCUSSIONS]: [{ id: 'd1', notes: [note(1, {}), note(2, { author: { id: 5, username: 'guest' } }), note(3, { author: { id: 6, username: 'stranger' } }), note(4, {})] }],
        'GET /members/all/3': { access_level: 20 },
        'GET /members/all/5': { access_level: 10 },
      },
      (line) => lines.push(line),
    )
    expect((await pulls.remarks(9, SINCE, all)).map((remark) => remark.key)).toEqual(['note:1', 'note:4'])
    expect(asked.filter((each) => each.url.endsWith('/members/all/3'))).toHaveLength(1)
    expect(lines).toEqual([
      'gitlab: group/sub/app!9: note 2 of guest is skipped: its author is not a Reporter or above in group/sub/app',
      'gitlab: group/sub/app!9: note 3 of stranger is skipped: its author is not a Reporter or above in group/sub/app',
    ])
  })
})
