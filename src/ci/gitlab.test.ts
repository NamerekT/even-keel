import { describe, expect, it } from 'vitest'
import { noticeOf } from '../notice/notice.js'
import { gitlabSource } from './gitlab.js'
import { logTail } from './report.js'

const PIPELINE = {
  id: 47, iid: 12, name: null, sha: 'abc123', ref: 'dev', status: 'success',
  created_at: '2026-10-25T10:00:00Z', started_at: '2026-10-25T10:00:05Z', finished_at: '2026-10-25T10:01:00Z',
  web_url: 'https://git.example.com/lab/group/sub/app/-/pipelines/47',
}
const BASE = 'https://git.example.com/lab/api/v4/projects/group%2Fsub%2Fapp'
function fake(routes: Record<string, unknown>) {
  const asked: { url: string; auth: string | null }[] = []
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    asked.push({ url, auth: new Headers(init?.headers).get('authorization') })
    const body = routes[url.replace(BASE, '')]
    return body instanceof Response ? body : Response.json(body ?? {}, { status: body === undefined ? 404 : 200 })
  }) as typeof fetch
  return { asked, source: gitlabSource({ web: 'https://git.example.com/lab', owner: 'group/sub', repo: 'app', token: 'fake-token' }, 1_000, fetchImpl) }
}

describe('gitlabSource', () => {
  it('filters and escapes the branch, reads timing from details and authenticates on the configured server', async () => {
    const { asked, source } = fake({ '/pipelines?per_page=10&page=1&order_by=id&sort=desc&ref=release%2Fv0.2': [PIPELINE], '/pipelines/47': PIPELINE })
    expect(await source.runs(10, 'release/v0.2')).toEqual([{
      id: 47, number: 12, title: 'dev', workflow: 'GitLab CI', commit: 'abc123', status: 'success',
      createdAt: PIPELINE.created_at, startedAt: PIPELINE.started_at, stoppedAt: PIPELINE.finished_at, url: PIPELINE.web_url,
    }])
    expect(asked).toEqual([
      { url: `${BASE}/pipelines?per_page=10&page=1&order_by=id&sort=desc&ref=release%2Fv0.2`, auth: 'Bearer fake-token' },
      { url: `${BASE}/pipelines/47`, auth: 'Bearer fake-token' },
    ])
  })

  it('maps pipeline states without treating manual and scheduled as failures', async () => {
    const states = ['created', 'pending', 'running', 'success', 'failed', 'canceled', 'skipped', 'manual', 'scheduled', 'waiting_for_resource', 'preparing']
    const pipelines = states.map((status, id) => ({ ...PIPELINE, id, status }))
    const { source } = fake({ '/pipelines?per_page=11&page=1&order_by=id&sort=desc': pipelines, ...Object.fromEntries(pipelines.map((run) => [`/pipelines/${run.id}`, run])) })
    const runs = await source.runs(11)
    expect(runs.map((run) => run.status)).toEqual(['queued', 'queued', 'running', 'success', 'failure', 'cancelled', 'skipped', 'skipped', 'queued', 'queued', 'running'])
    expect(runs[0]).toMatchObject({ startedAt: null, stoppedAt: null })
    expect(runs[2]).toMatchObject({ startedAt: PIPELINE.started_at, stoppedAt: null })
  })

  it('collects all job pages, omits retried attempts and has no steps', async () => {
    const job = { id: 11, name: 'test', status: 'failed', started_at: PIPELINE.started_at, finished_at: PIPELINE.finished_at }
    const { asked, source } = fake({
      '/pipelines/47/jobs?per_page=100&page=1': Response.json([job], { headers: { 'x-next-page': '2' } }),
      '/pipelines/47/jobs?per_page=100&page=2': [{ ...job, id: 12, name: 'deploy', status: 'manual', started_at: null, finished_at: null }],
    })
    expect(await source.jobs({ id: 47 } as never)).toEqual([
      { id: 11, name: 'test', status: 'failure', startedAt: PIPELINE.started_at, stoppedAt: PIPELINE.finished_at, steps: null },
      { id: 12, name: 'deploy', status: 'skipped', startedAt: null, stoppedAt: null, steps: null },
    ])
    expect(asked).toHaveLength(2)
  })

  it('marks a job GitLab dropped as stuck before any runner took it (BTN-761)', async () => {
    const stuck = { id: 11, name: 'test', status: 'failed', failure_reason: 'stuck_or_timeout_failure', started_at: null, finished_at: PIPELINE.finished_at }
    const { source } = fake({
      '/pipelines/47/jobs?per_page=100&page=1': [
        stuck,
        { ...stuck, id: 12, started_at: PIPELINE.started_at },
        { ...stuck, id: 13, failure_reason: 'script_failure' },
      ],
    })
    expect((await source.jobs({ id: 47 } as never)).map((job) => [job.id, job.status, job.notTaken ?? false])).toEqual([
      [11, 'failure', true],
      [12, 'failure', false],
      [13, 'failure', false],
    ])
  })

  it('reads a job trace as text with the token', async () => {
    const { asked, source } = fake({ '/jobs/11/trace': new Response('$ npm test\nFAIL', { status: 200 }) })
    expect(await source.log!({ id: 11 } as never)).toBe('$ npm test\nFAIL')
    expect(asked).toEqual([{ url: `${BASE}/jobs/11/trace`, auth: 'Bearer fake-token' }])
  })

  it("gives the report a tail without GitLab's stream prefixes and section markers", async () => {
    const trace = [
      '2026-11-02T02:33:42.673456Z 00O \u001b[0KRunning with gitlab-runner 18.5.0 (abcdef12)\u001b[0;m',
      '2026-11-02T02:33:42.673456Z 00O section_start:1793586822:prepare_executor\r\u001b[0K\u001b[0K\u001b[36;1mPreparing the "shell" executor\u001b[0;m\u001b[0;m',
      '2026-11-02T02:33:42.700000Z 00O \u001b[0KUsing Shell (bash) executor...\u001b[0;m',
      '2026-11-02T02:33:42.700000Z 00O section_end:1793586822:prepare_executor\r\u001b[0K',
      '2026-11-02T02:33:42.700000Z 00O ',
      '2026-11-02T02:33:59.000000Z 0aO section_start:1793586839:step_script[collapsed=true]\r\u001b[0K',
      '2026-11-02T02:33:59.112233Z 01O \u001b[32;1m$ test ! -f ci-red.txt\u001b[0;m',
      '2026-11-02T02:33:59.112233Z 01O+ ci-red.txt is present, failing',
      '2026-11-02T02:33:59.200000Z 00O section_end:1793586839:step_script\r\u001b[0K',
      '2026-11-02T02:33:59.200000Z 00E \u001b[31;1mERROR: Job failed: exit status 1',
      '2026-11-02T02:33:59.200000Z 00O \u001b[0;m',
      '',
    ].join('\n')
    const { source } = fake({ '/jobs/11/trace': new Response(trace, { status: 200 }) })
    expect(logTail(await source.log!({ id: 11 } as never))).toBe(
      [
        'Running with gitlab-runner 18.5.0 (abcdef12)',
        'Preparing the "shell" executor',
        'Using Shell (bash) executor...',
        '',
        '$ test ! -f ci-red.txt',
        'ci-red.txt is present, failing',
        'ERROR: Job failed: exit status 1',
      ].join('\n'),
    )
  })

  it('keeps a trace without timestamps as it is, section markers aside', async () => {
    const trace = 'section_start:1:step_script\r\u001b[0K\n00O is output here\nsection_end:1:step_script\r\u001b[0K\nFAIL'
    const { source } = fake({ '/jobs/11/trace': new Response(trace, { status: 200 }) })
    expect(logTail(await source.log!({ id: 11 } as never))).toBe('00O is output here\nFAIL')
  })

  it.each([401, 403, 404])('uses the shared CI errors for HTTP %s so a refused CI can be hidden', async (status) => {
    const { source } = fake({ '/pipelines?per_page=10&page=1&order_by=id&sort=desc': new Response('', { status }) })
    const error = await source.runs(10).catch((error: unknown) => error)
    expect(noticeOf(error)).toMatchObject(status === 404 ? { code: 'ci.http', params: { status } } : { code: 'ci.denied', params: { status } })
  })
})
