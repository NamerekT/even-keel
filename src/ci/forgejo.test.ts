import { describe, expect, it } from 'vitest'
import { NoticeError } from '../notice/notice.js'
import { forgejoSource } from './forgejo.js'

const TARGET = { web: 'https://forgejo.example.com', owner: 'john', repo: 'app' }

function fake(routes: Record<string, unknown>, status = 200) {
  const asked: { url: string; auth: string | null }[] = []
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    asked.push({ url, auth: new Headers(init?.headers).get('authorization') })
    const path = url.replace('https://forgejo.example.com/api/v1/repos/john/app', '')
    const body = routes[path]
    if (body === undefined) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return { asked, source: forgejoSource({ ...TARGET, token: 'fake-token' }, 1_000, fetchImpl) }
}

const RUN = {
  id: 501,
  index_in_repo: 41,
  title: '[ABC-7] Fix the parser',
  workflow_id: 'test.yml',
  commit_sha: 'c4a92ffa5e3a400ae7e9c40a2914e649eb338ad7',
  status: 'running',
  created: '2026-10-12T10:00:00Z',
  started: '2026-10-12T10:00:05Z',
  stopped: '0001-01-01T00:00:00Z',
  html_url: 'https://forgejo.example.com/john/app/actions/runs/41',
  event_payload: '{}',
}

describe('forgejoSource', () => {
  it('asks for the project branch with pagination', async () => {
    const { source } = fake({
      '/actions/runs?page=1&limit=10&ref=refs%2Fheads%2Frelease%2Fv0.1': { workflow_runs: [{ ...RUN, prettyref: 'release/v0.1' }] },
    })
    expect((await source.runs(10, 'release/v0.1')).map((run) => run.id)).toEqual([RUN.id])
  })

  it('asks for one page of runs with the token and maps them', async () => {
    const { asked, source } = fake({
      '/actions/runs?page=1&limit=10': {
        total_count: 2,
        workflow_runs: [RUN, { ...RUN, id: 500, index_in_repo: 40, status: 'waiting', started: '1970-01-01T00:00:00Z', stopped: '1970-01-01T00:00:00Z' }],
      },
    })
    const runs = await source.runs(10)
    expect(asked[0]).toEqual({ url: 'https://forgejo.example.com/api/v1/repos/john/app/actions/runs?page=1&limit=10', auth: 'token fake-token' })
    expect(runs).toEqual([
      {
        id: 501,
        number: 41,
        title: '[ABC-7] Fix the parser',
        workflow: 'test.yml',
        commit: 'c4a92ffa5e3a400ae7e9c40a2914e649eb338ad7',
        status: 'running',
        createdAt: '2026-10-12T10:00:00Z',
        startedAt: '2026-10-12T10:00:05Z',
        stoppedAt: null,
        url: 'https://forgejo.example.com/john/app/actions/runs/41',
      },
      expect.objectContaining({ id: 500, status: 'queued', startedAt: null, stoppedAt: null }),
    ])
  })

  it('maps every run status', async () => {
    const statuses = ['unknown', 'waiting', 'blocked', 'running', 'success', 'failure', 'cancelled', 'skipped']
    const { source } = fake({
      '/actions/runs?page=1&limit=8': { workflow_runs: statuses.map((status, id) => ({ ...RUN, id, status })) },
    })
    expect((await source.runs(8)).map((run) => run.status)).toEqual(['queued', 'queued', 'queued', 'running', 'success', 'failure', 'cancelled', 'skipped'])
  })

  it('times the jobs by their tasks and gives no steps', async () => {
    const { source } = fake({
      '/actions/runs/501/jobs': [
        { id: 9, run_id: 501, name: 'test', status: 'success', task_id: 77 },
        { id: 10, run_id: 501, name: 'deploy', status: 'waiting', task_id: 0 },
      ],
      '/actions/tasks?page=1&limit=50': {
        workflow_runs: [
          { id: 77, name: 'test', status: 'success', run_started_at: '2026-10-12T10:00:06Z', updated_at: '2026-10-12T10:02:30Z' },
          { id: 76, name: 'test', status: 'failure', run_started_at: '2026-10-11T10:00:06Z', updated_at: '2026-10-11T10:02:30Z' },
        ],
      },
    })
    const [run] = [{ id: 501 } as never]
    expect(await source.jobs(run)).toEqual([
      { id: 9, name: 'test', status: 'success', startedAt: '2026-10-12T10:00:06Z', stoppedAt: '2026-10-12T10:02:30Z', steps: null },
      { id: 10, name: 'deploy', status: 'queued', startedAt: null, stoppedAt: null, steps: null },
    ])
  })

  it('leaves a running job without a stop', async () => {
    const { source } = fake({
      '/actions/runs/501/jobs': [{ id: 9, run_id: 501, name: 'test', status: 'running', task_id: 77 }],
      '/actions/tasks?page=1&limit=50': { workflow_runs: [{ id: 77, status: 'running', run_started_at: '2026-10-12T10:00:06Z', updated_at: '2026-10-12T10:01:00Z' }] },
    })
    expect((await source.jobs({ id: 501 } as never))[0]).toMatchObject({ startedAt: '2026-10-12T10:00:06Z', stoppedAt: null })
  })

  it('names a refused token', async () => {
    const { source } = fake({ '/actions/runs?page=1&limit=10': { message: 'token is required' } }, 401)
    const error = await source.runs(10).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(NoticeError)
    expect((error as NoticeError).notice).toMatchObject({ code: 'ci.denied', params: { ci: 'Forgejo', status: 401 } })
  })
})
