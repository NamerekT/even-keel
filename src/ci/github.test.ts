import { describe, expect, it } from 'vitest'
import { githubActionsSource } from './github.js'

function fake(routes: Record<string, unknown>) {
  const asked: { url: string; auth: string | null }[] = []
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    asked.push({ url, auth: new Headers(init?.headers).get('authorization') })
    const body = routes[url.replace('https://api.github.com/repos/octo-org/app', '')]
    return new Response(JSON.stringify(body ?? {}), { status: body === undefined ? 404 : 200 })
  }) as typeof fetch
  return { asked, source: githubActionsSource({ owner: 'octo-org', repo: 'app', token: 'fake-token' }, 1_000, fetchImpl) }
}

const RUN = {
  id: 38171546488,
  name: 'Tests',
  display_title: '[ABC-7] Fix the parser',
  head_sha: '5c95521730bbc58ab20052f7ff807c29a8fbeb65',
  status: 'completed',
  conclusion: 'success',
  run_number: 17303,
  created_at: '2026-10-11T20:17:02Z',
  run_started_at: '2026-10-11T20:17:05Z',
  updated_at: '2026-10-11T20:20:03Z',
  html_url: 'https://github.com/octo-org/app/actions/runs/38171546488',
}

describe('githubActionsSource', () => {
  it('maps the latest runs', async () => {
    const { asked, source } = fake({ '/actions/runs?per_page=10': { workflow_runs: [RUN] } })
    expect(await source.runs(10)).toEqual([
      {
        id: 38171546488,
        number: 17303,
        title: '[ABC-7] Fix the parser',
        workflow: 'Tests',
        commit: '5c95521730bbc58ab20052f7ff807c29a8fbeb65',
        status: 'success',
        createdAt: '2026-10-11T20:17:02Z',
        startedAt: '2026-10-11T20:17:05Z',
        stoppedAt: '2026-10-11T20:20:03Z',
        url: 'https://github.com/octo-org/app/actions/runs/38171546488',
      },
    ])
    expect(asked[0]!.auth).toBe('Bearer fake-token')
  })

  it('maps statuses and conclusions', async () => {
    const pairs: [string, string | null][] = [
      ['queued', null],
      ['waiting', null],
      ['in_progress', null],
      ['completed', 'failure'],
      ['completed', 'timed_out'],
      ['completed', 'cancelled'],
      ['completed', 'skipped'],
      ['completed', 'neutral'],
    ]
    const { source } = fake({
      '/actions/runs?per_page=8': { workflow_runs: pairs.map(([status, conclusion], id) => ({ ...RUN, id, status, conclusion })) },
    })
    const runs = await source.runs(8)
    expect(runs.map((run) => run.status)).toEqual(['queued', 'queued', 'running', 'failure', 'failure', 'cancelled', 'skipped', 'success'])
    expect(runs[0]).toMatchObject({ startedAt: null, stoppedAt: null })
    expect(runs[2]).toMatchObject({ startedAt: '2026-10-11T20:17:05Z', stoppedAt: null })
  })

  it('gives jobs with their steps', async () => {
    const { source } = fake({
      '/actions/runs/7/jobs?per_page=100': {
        jobs: [
          {
            id: 11,
            name: 'test',
            status: 'in_progress',
            conclusion: null,
            started_at: '2026-10-11T20:17:06Z',
            completed_at: null,
            steps: [
              { name: 'Set up job', status: 'completed', conclusion: 'success', started_at: '2026-10-11T20:17:06Z', completed_at: '2026-10-11T20:17:08Z' },
              { name: 'npm test', status: 'in_progress', conclusion: null, started_at: '2026-10-11T20:17:08Z', completed_at: null },
              { name: 'Post checkout', status: 'queued', conclusion: null, started_at: null, completed_at: null },
            ],
          },
        ],
      },
    })
    expect(await source.jobs({ id: 7 } as never)).toEqual([
      {
        id: 11,
        name: 'test',
        status: 'running',
        startedAt: '2026-10-11T20:17:06Z',
        stoppedAt: null,
        steps: [
          { name: 'Set up job', status: 'success', startedAt: '2026-10-11T20:17:06Z', stoppedAt: '2026-10-11T20:17:08Z' },
          { name: 'npm test', status: 'running', startedAt: '2026-10-11T20:17:08Z', stoppedAt: null },
          { name: 'Post checkout', status: 'queued', startedAt: null, stoppedAt: null },
        ],
      },
    ])
  })
})
