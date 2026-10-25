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
