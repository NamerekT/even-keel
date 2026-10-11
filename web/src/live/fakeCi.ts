import type { CiJob, CiRun, CiView, RunStatus } from '../../../src/ci/model.js'
import { notice } from '../../../src/notice/notice.js'

const ago = (seconds: number) => new Date(Date.now() - seconds * 1_000).toISOString()

function run(number: number, status: RunStatus, startedAgo: number, length: number | null, title: string): CiRun {
  const sha = (number * 2_654_435_761).toString(16).padStart(8, '0').slice(-8)
  return {
    id: 9_000 + number,
    number,
    title,
    workflow: 'test.yml',
    commit: `${sha}${sha}${sha}${sha}${sha}`,
    status,
    createdAt: ago(startedAgo + 4),
    startedAt: status === 'queued' ? null : ago(startedAgo),
    stoppedAt: length === null ? null : ago(startedAgo - length),
    url: `https://forgejo.example.com/john/abc/actions/runs/${number}`,
  }
}

const HISTORY: CiRun[] = [
  run(40, 'success', 1_800, 192, '[ABC-4] Ретраи загрузки'),
  run(39, 'failure', 7_200, 75, '[ABC-3] Новая схема конфигурации'),
  run(38, 'success', 20_000, 185, '[ABC-2] Ошибки в логах'),
  run(37, 'cancelled', 40_000, 20, '[ABC-2] Ошибки в логах'),
  run(36, 'success', 90_000, 201, '[ABC-1] Стартовый экран'),
]

const STEPS = ['Set up job', 'Checkout', 'npm ci', 'npm run typecheck', 'npm test', 'Post Checkout']

function job(id: number, name: string, status: RunStatus, startedAgo: number | null, length: number | null, steps: boolean): CiJob {
  const shown = steps
    ? STEPS.map((step, index) => {
        const done = status !== 'running' || index < 3
        const current = status === 'running' && index === 3
        return {
          name: step,
          status: done ? status === 'running' ? 'success' : status : current ? 'running' : 'queued',
          startedAt: done || current ? ago((startedAgo ?? 0) - index * 10) : null,
          stoppedAt: done ? ago((startedAgo ?? 0) - index * 10 - 9) : null,
        } as const
      })
    : null
  return { id, name, status, startedAt: startedAgo === null ? null : ago(startedAgo), stoppedAt: length === null || startedAgo === null ? null : ago(startedAgo - length), steps: shown }
}

function forgejo(over: Partial<CiView> = {}): CiView {
  const current = run(41, 'running', 160, null, '[ABC-5] Экспорт отчёта')
  return {
    kind: 'forgejo',
    remote: 'origin',
    url: 'https://forgejo.example.com/john/abc/actions',
    health: 'ok',
    error: null,
    checkedAt: ago(6),
    current: { run: current, tasks: ['ABC-5', 'ABC-4'], jobs: [job(1, 'test', 'running', 156, null, false), job(2, 'deploy', 'queued', null, null, false)] },
    history: [current, ...HISTORY],
    medianMs: 190_000,
    pushed: null,
    ...over,
  }
}

function github(): CiView {
  const last = { ...HISTORY[0]!, url: 'https://github.com/octo-org/abc/actions/runs/40' }
  return {
    kind: 'github',
    remote: 'github',
    url: 'https://github.com/octo-org/abc/actions',
    health: 'ok',
    error: null,
    checkedAt: ago(1_700),
    current: { run: last, tasks: ['ABC-4'], jobs: [job(3, 'test', 'success', 1_800, 192, true)] },
    history: [last, ...HISTORY.slice(1)],
    medianMs: 190_000,
    pushed: null,
  }
}

/** `?ci=failure|stuck|push|error|off|none`; without it ABC has a running Forgejo run and a green GitHub Actions. */
export function fakeCi(kind: string | null): Record<string, CiView[]> {
  if (kind === 'none') return {}
  const finished = forgejo({ current: { run: HISTORY[0]!, tasks: ['ABC-4'], jobs: [job(1, 'test', 'success', 1_800, 192, false)] }, history: HISTORY })
  const views: Record<string, CiView> = {
    failure: forgejo({
      current: { run: HISTORY[1]!, tasks: ['ABC-3'], jobs: [job(1, 'test', 'failure', 7_200, 75, false), job(2, 'deploy', 'skipped', null, null, false)] },
      history: HISTORY.slice(1),
    }),
    stuck: forgejo({
      current: { run: run(41, 'queued', 300, null, '[ABC-5] Экспорт отчёта'), tasks: ['ABC-5'], jobs: [job(1, 'test', 'queued', null, null, false)] },
    }),
    push: { ...finished, pushed: { commit: '5c95521730bbc58ab20052f7ff807c29a8fbeb65', at: ago(40) } },
    error: { ...finished, health: 'error', error: notice('ci.unreachable', { ci: 'Forgejo' }, { detail: 'connect ETIMEDOUT 100.64.0.1:443' }), checkedAt: ago(30) },
    off: { ...forgejo(), health: 'off', error: notice('ci.noToken', { variable: 'FORGEJO_TOKEN' }), checkedAt: null, current: null, history: [], medianMs: null },
  }
  return { ABC: [views[kind ?? ''] ?? forgejo(), github()], DEMO: [finished] }
}
