import { afterEach, expect, it, vi } from 'vitest'
import { SESSION_MARK } from './model.js'
import { reviewDeps } from './wiring.js'

afterEach(() => vi.unstubAllGlobals())

it('keeps task-branch CI failures as PR feedback while the project main is dev', async () => {
  const at = '2026-10-25T10:00:00Z'
  const asked: string[] = []
  const routes: Record<string, unknown> = {
    '/pulls/7': { state: 'open', mergeable: true, head: { sha: 'task-head', ref: 'abc-7/task' } },
    '/pulls/7/reviews?per_page=100': [],
    [`/issues/7/comments?since=${encodeURIComponent(at)}&per_page=100`]: [],
    '/actions/runs?per_page=20': {
      workflow_runs: ['dev-head', 'task-head', 'another-task'].map((head_sha, id) => ({
        id, head_sha, head_branch: head_sha === 'dev-head' ? 'dev' : 'abc-7/task',
        status: 'completed', conclusion: 'failure', run_number: id,
        name: 'Tests', display_title: 'Test run', created_at: at, run_started_at: at, updated_at: at,
        html_url: `https://github.com/octo-org/app/actions/runs/${id}`,
      })),
    },
  }
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const path = String(input).replace('https://api.github.com/repos/octo-org/app', '')
    asked.push(path)
    return new Response(JSON.stringify(routes[path] ?? {}), { status: path in routes ? 200 : 404 })
  })
  const deps = reviewDeps({
    git: async () => ({ code: 0, out: 'remote.origin.url https://github.com/octo-org/app.git' }),
    repo: () => 'D:/repos/app', main: () => 'dev', on: () => true,
    token: () => 'fake-token', complete: async () => {}, now: () => new Date(at), timeoutMs: 1_000,
  })
  const check = await deps.check('p1', {
    task: 'ABC-7', remote: 'origin', number: 7, branch: 'abc-7/task',
    url: 'https://github.com/octo-org/app/pull/7', at, pushedAt: at, markAt: null, seen: [],
  })
  expect(check.failed.map(({ run }) => run.commit)).toEqual(['task-head'])
  expect(asked).toContain('/actions/runs?per_page=20')
  expect(asked.some((path) => path.includes('branch=') || path.includes('ref='))).toBe(false)
})

it('takes a Forgejo "not mergeable" for unknown in the first minute after the push, and for a conflict after it (BTN-717)', async () => {
  const pushedAt = '2026-11-02T10:01:21Z'
  let now = '2026-11-02T10:01:23Z'
  const routes: Record<string, unknown> = {
    '/pulls/8': { number: 8, html_url: '', state: 'open', mergeable: false, head: { sha: 'ce7ce32', ref: 'abc-7/task' } },
    '/pulls/8/reviews?page=1&limit=50': [],
    [`/issues/8/comments?since=${encodeURIComponent(pushedAt)}`]: [],
  }
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const path = String(input).replace('https://git.example.com/api/v1/repos/acme/app', '')
    return new Response(JSON.stringify(routes[path] ?? {}), { status: path in routes ? 200 : 404 })
  })
  const deps = reviewDeps({
    git: async () => ({ code: 0, out: 'remote.origin.url https://git.example.com/acme/app.git' }),
    repo: () => 'D:/repos/app', main: () => 'main', on: () => true,
    token: () => 'fake-token', complete: async () => {}, now: () => new Date(now), timeoutMs: 1_000,
  })
  const pull = {
    task: 'ABC-7', remote: 'origin', number: 8, branch: 'abc-7/task',
    url: 'https://git.example.com/acme/app/pulls/8', at: pushedAt, pushedAt, markAt: null, seen: [],
  }
  expect((await deps.check('p1', pull)).state).toEqual({ state: 'open', mergeable: null, head: 'ce7ce32' })
  now = '2026-11-02T10:02:21Z'
  expect((await deps.check('p1', pull)).state).toEqual({ state: 'open', mergeable: false, head: 'ce7ce32' })
})

it("gives a failed run of the PR head the log tail of its failed job, once, and the link alone when the log fails", async () => {
  const at = '2026-10-25T10:00:00Z'
  const asked: string[] = []
  const routes: Record<string, unknown> = {
    '/pulls/7': { state: 'open', mergeable: true, head: { sha: 'task-head', ref: 'abc-7/task' } },
    '/pulls/7/reviews?per_page=100': [],
    [`/issues/7/comments?since=${encodeURIComponent(at)}&per_page=100`]: [],
    '/actions/runs?per_page=20': {
      workflow_runs: [1, 2].map((id) => ({
        id, head_sha: 'task-head', head_branch: 'abc-7/task', status: 'completed', conclusion: 'failure', run_number: id,
        name: 'Tests', display_title: 'Test run', created_at: at, run_started_at: at, updated_at: at,
        html_url: `https://github.com/octo-org/app/actions/runs/${id}`,
      })),
    },
    '/actions/runs/1/jobs?per_page=100': { jobs: [
      { id: 30, name: 'lint', status: 'completed', conclusion: 'success', started_at: at, completed_at: at },
      { id: 31, name: 'test', status: 'completed', conclusion: 'failure', started_at: at, completed_at: at },
    ] },
    '/actions/jobs/31/logs': '2026-10-25T10:00:01.1234567Z npm test\n2026-10-25T10:00:02.1234567Z error TS2741\n',
    '/actions/runs/2/jobs?per_page=100': { jobs: [{ id: 41, name: 'test', status: 'completed', conclusion: 'failure', started_at: at, completed_at: at }] },
  }
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const path = String(input).replace('https://api.github.com/repos/octo-org/app', '')
    asked.push(path)
    const body = routes[path]
    return new Response(typeof body === 'string' ? body : JSON.stringify(body ?? {}), { status: path in routes ? 200 : 404 })
  })
  const deps = reviewDeps({
    git: async () => ({ code: 0, out: 'remote.origin.url https://github.com/octo-org/app.git' }),
    repo: () => 'D:/repos/app', main: () => 'dev', on: () => true,
    token: () => 'fake-token', complete: async () => {}, now: () => new Date(at), timeoutMs: 1_000,
  })
  const pull = {
    task: 'ABC-7', remote: 'origin', number: 7, branch: 'abc-7/task',
    url: 'https://github.com/octo-org/app/pull/7', at, pushedAt: at, markAt: null, seen: [] as string[],
  }
  const check = await deps.check('p1', pull)
  expect(check.failed.map(({ run, log }) => [run.id, log])).toEqual([[1, 'npm test\nerror TS2741'], [2, null]])

  asked.length = 0
  await deps.check('p1', { ...pull, seen: ['ci:1', 'ci:2'] })
  expect(asked.filter((path) => path.includes('/jobs'))).toEqual([])
})

it('polls a GitLab merge request: its state, its notes and the failed pipelines of its head commit', async () => {
  const at = '2026-10-25T10:00:00Z'
  const later = '2026-10-25T11:00:00Z'
  const pipeline = (id: number, sha: string) => ({
    id, iid: id, name: null, ref: 'abc-7/task', sha, status: 'failed', created_at: at, started_at: at, finished_at: later,
    web_url: `https://gitlab.com/group/sub/app/-/pipelines/${id}`,
  })
  const routes: Record<string, unknown> = {
    '/merge_requests/7': { iid: 7, web_url: 'https://gitlab.com/group/sub/app/-/merge_requests/7', state: 'opened', sha: 'task-head', has_conflicts: true },
    '/merge_requests/7/discussions?per_page=100&page=1': [
      { id: 'd1', notes: [{ id: 31, type: null, body: 'Rename it', author: { id: 3, username: 'jdoe' }, created_at: later, system: false }] },
    ],
    '/members/all/3': { access_level: 30 },
    '/pipelines?per_page=20&page=1&order_by=id&sort=desc': [{ id: 1 }, { id: 2 }],
    '/pipelines/1': pipeline(1, 'old-head'),
    '/pipelines/2': pipeline(2, 'task-head'),
  }
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const path = String(input).replace('https://gitlab.com/api/v4/projects/group%2Fsub%2Fapp', '')
    return new Response(JSON.stringify(routes[path] ?? {}), { status: path in routes ? 200 : 404 })
  })
  const deps = reviewDeps({
    git: async () => ({ code: 0, out: 'remote.origin.url git@gitlab.com:group/sub/app.git' }),
    repo: () => 'D:/repos/app', main: () => 'dev', on: () => true,
    token: () => 'fake-token', complete: async () => {}, now: () => new Date(at), timeoutMs: 1_000,
  })
  const check = await deps.check('p1', {
    task: 'ABC-7', remote: 'origin', number: 7, branch: 'abc-7/task',
    url: 'https://gitlab.com/group/sub/app/-/merge_requests/7', at, pushedAt: at, markAt: null, seen: [],
  })
  expect(check.state).toEqual({ state: 'open', mergeable: false, head: 'task-head' })
  expect(check.remarks.map((remark) => remark.key)).toEqual(['note:31'])
  expect(check.failed.map(({ run }) => run.id)).toEqual([2])
})

it("does not give a session its own note on its merge request as a remark, open or closed (BTN-442)", async () => {
  const at = '2026-10-25T10:00:00Z'
  const later = '2026-10-25T11:00:00Z'
  let state = 'opened'
  const routes: Record<string, unknown> = {
    '/merge_requests/7/discussions?per_page=100&page=1': [
      { id: 'd1', notes: [{ id: 34, type: null, body: `The red pipeline is expected.\n\n${SESSION_MARK}`, author: { id: 1, username: 'root' }, created_at: later, system: false }] },
      { id: 'd2', notes: [{ id: 35, type: null, body: 'Rename it', author: { id: 1, username: 'root' }, created_at: later, system: false }] },
    ],
    '/members/all/1': { access_level: 50 },
  }
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const path = String(input).replace('https://gitlab.com/api/v4/projects/group%2Fapp', '')
    const body = path === '/merge_requests/7' ? { iid: 7, web_url: 'https://gitlab.com/group/app/-/merge_requests/7', state, sha: 'head' } : routes[path]
    return new Response(JSON.stringify(body ?? []), { status: body === undefined && !path.startsWith('/pipelines') ? 404 : 200 })
  })
  const deps = reviewDeps({
    git: async () => ({ code: 0, out: 'remote.origin.url git@gitlab.com:group/app.git' }),
    repo: () => 'D:/repos/app', main: () => 'dev', on: () => true,
    token: () => 'fake-token', complete: async () => {}, now: () => new Date(at), timeoutMs: 1_000,
  })
  const pull = {
    task: 'ABC-7', remote: 'origin', number: 7, branch: 'abc-7/task',
    url: 'https://gitlab.com/group/app/-/merge_requests/7', at, pushedAt: at, markAt: null, seen: [],
  }
  expect((await deps.check('p1', pull)).remarks.map((remark) => remark.key)).toEqual(['note:35'])
  state = 'closed'
  expect((await deps.check('p1', pull)).remarks.map((remark) => remark.key)).toEqual(['note:35'])
})
