import { afterEach, expect, it, vi } from 'vitest'
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
  expect(check.failed.map((run) => run.commit)).toEqual(['task-head'])
  expect(asked).toContain('/actions/runs?per_page=20')
  expect(asked.some((path) => path.includes('branch=') || path.includes('ref='))).toBe(false)
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
  expect(check.failed.map((run) => run.id)).toEqual([2])
})
