import type { CiJob, CiRun, CiView, CurrentRun, RunEvent, RunStatus } from '../../../src/ci/model.js'
import { notice } from '../../../src/notice/notice.js'

const ago = (seconds: number) => new Date(Date.now() - seconds * 1_000).toISOString()

/** The commit of each fake push, by its number. */
const sha = (push: number) => (push * 2_654_435_761).toString(16).padStart(8, '0').slice(-8).repeat(5)

const TITLES: Record<number, string> = {
  1: '[ABC-1] Стартовый экран',
  2: '[ABC-2] Ошибки в логах',
  3: '[ABC-3] Новая схема конфигурации',
  4: '[ABC-4] Ретраи загрузки',
  5: '[ABC-5] Экспорт отчёта',
  9: 'Fix main: restore the config fixture',
}

const FORGEJO = 'https://forgejo.example.com/john/abc/actions'
const GITHUB = 'https://github.com/octo-org/abc/actions'

interface Fake {
  push: number
  status: RunStatus
  startedAgo: number
  length: number | null
  workflow?: string
  event?: RunEvent
  url?: string
}

function run(number: number, fake: Fake): CiRun {
  const { push, status, startedAgo, length, workflow = 'test.yml', event = 'push', url = FORGEJO } = fake
  return {
    id: (url === GITHUB ? 20_000 : 9_000) + number,
    number,
    title: event === 'push' ? TITLES[push]! : workflow,
    workflow,
    commit: sha(push),
    status,
    event,
    createdAt: ago(startedAgo + 4),
    startedAt: status === 'queued' ? null : ago(startedAgo),
    stoppedAt: length === null ? null : ago(startedAgo - length),
    url: `${url}/runs/${number}`,
  }
}

const HISTORY: CiRun[] = [
  run(40, { push: 4, status: 'success', startedAgo: 1_800, length: 192 }),
  run(39, { push: 3, status: 'failure', startedAgo: 7_200, length: 75 }),
  run(38, { push: 2, status: 'success', startedAgo: 20_000, length: 185 }),
  run(37, { push: 2, status: 'cancelled', startedAgo: 40_000, length: 20 }),
  run(36, { push: 1, status: 'success', startedAgo: 90_000, length: 201 }),
]

const FIX_RUN = run(41, { push: 9, status: 'success', startedAgo: 900, length: 180 })

/** The fix of a red main in the fake chain archive: the red #39 and the green #41 of `?ci=fixed`. */
export const FAKE_FIX = { red: HISTORY[1]!.commit, landed: FIX_RUN.commit }

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

/** The push of `runs`, each with its jobs. */
function current(runs: [CiRun, CiJob[]][], tasks: string[]): CurrentRun {
  const [first] = runs[0]!
  return { commit: first.commit, title: first.title, manual: first.event !== 'push', tasks, runs: runs.map(([each, jobs]) => ({ run: each, jobs })) }
}

function forgejo(over: Partial<CiView> = {}): CiView {
  const going = run(41, { push: 5, status: 'running', startedAgo: 160, length: null })
  return {
    kind: 'forgejo',
    remote: 'origin',
    repository: 'john/abc',
    counted: true,
    url: FORGEJO,
    health: 'ok',
    error: null,
    checkedAt: ago(6),
    current: current([[going, [job(1, 'test', 'running', 156, null, false), job(2, 'deploy', 'queued', null, null, false)]]], ['ABC-5', 'ABC-4']),
    history: [going, ...HISTORY],
    medians: { 'test.yml': 190_000 },
    pushed: null,
    ...over,
  }
}

const github = (fake: Omit<Fake, 'url'>) => run(fake.workflow === 'macOS' ? fake.push + 186 : fake.workflow === 'Nightly' ? 88 + fake.push : fake.push + 743, { ...fake, url: GITHUB })

/** GitHub runs two workflows on each push and a nightly one by hand; the project does not count it (only Forgejo). */
function githubView(finished: boolean): CiView {
  const tests = github({ push: 5, status: 'success', startedAgo: 170, length: 140, workflow: 'Tests' })
  const macos = github({ push: 5, status: finished ? 'success' : 'running', startedAgo: 150, length: finished ? 455 : null, workflow: 'macOS' })
  const past: CiRun[] = [
    github({ push: 4, status: 'success', startedAgo: 1_000, length: 610, workflow: 'Nightly', event: 'manual' }),
    github({ push: 4, status: 'success', startedAgo: 1_800, length: 150, workflow: 'Tests' }),
    github({ push: 4, status: 'success', startedAgo: 1_790, length: 470, workflow: 'macOS' }),
    github({ push: 3, status: 'failure', startedAgo: 7_200, length: 80, workflow: 'Tests' }),
    github({ push: 3, status: 'success', startedAgo: 7_190, length: 480, workflow: 'macOS' }),
    github({ push: 2, status: 'success', startedAgo: 20_000, length: 148, workflow: 'Tests' }),
    github({ push: 2, status: 'success', startedAgo: 19_990, length: 465, workflow: 'macOS' }),
  ]
  const latest = finished ? [past[1]!, past[2]!] : [tests, macos]
  return {
    kind: 'github',
    remote: 'github',
    repository: 'octo-org/abc',
    counted: false,
    url: GITHUB,
    health: 'ok',
    error: null,
    checkedAt: ago(20),
    current: current(
      latest.map((each, index) => [each, [job(3 + index, each.workflow === 'macOS' ? 'test (macos-latest)' : 'test', each.status, 160, each.stoppedAt === null ? null : 140, true)]]),
      finished ? ['ABC-4'] : ['ABC-5'],
    ),
    history: finished ? past : [tests, macos, ...past],
    medians: { Tests: 150_000, macOS: 470_000, Nightly: 610_000 },
    pushed: null,
  }
}

/**
 * `?ci=failure|stuck|busy|nottaken|push|fixed|mirror|error|off|none`; without it ABC has a running Forgejo run and
 * an uncounted GitHub Actions whose push runs two workflows, one still going.
 */
export function fakeCi(kind: string | null): Record<string, CiView[]> {
  if (kind?.startsWith('gitlab')) {
    const view = fakeCi(kind.slice(7) || null).ABC![0]!
    const url = 'https://gitlab.example.com/group/subgroup/app/-/pipelines'
    const gitlab = (each: CiRun): CiRun => ({ ...each, workflow: 'GitLab CI', url: `${url}/${each.id}` })
    return { ABC: [{ ...view, kind: 'gitlab', url, repository: 'group/subgroup/app', history: view.history.map(gitlab),
      medians: { 'GitLab CI': 190_000 },
      error: view.error?.code === 'ci.noToken' ? notice('ci.noToken', { kind: 'gitlab' }) : view.error ? notice('ci.unreachable', { ci: 'GitLab CI' }) : null,
      current: view.current ? { ...view.current, runs: view.current.runs.map((each) => ({ ...each, run: gitlab(each.run) })) } : null,
    }] }
  }
  if (kind === 'none') return {}
  const finished = forgejo({ current: current([[HISTORY[0]!, [job(1, 'test', 'success', 1_800, 192, false)]]], ['ABC-4']), history: HISTORY })
  const queued = run(42, { push: 5, status: 'queued', startedAgo: 300, length: null })
  const untaken = { ...run(42, { push: 5, status: 'failure', startedAgo: 1_200, length: 900 }), notTaken: true }
  const notTakenJob: CiJob = { ...job(1, 'test', 'cancelled', null, null, false), notTaken: true }
  const views: Record<string, CiView> = {
    failure: forgejo({
      current: current([[HISTORY[1]!, [job(1, 'test', 'failure', 7_200, 75, false), job(2, 'deploy', 'skipped', null, null, false)]]], ['ABC-3']),
      history: HISTORY.slice(1),
    }),
    stuck: forgejo({ current: current([[queued, [job(1, 'test', 'queued', null, null, false)]]], ['ABC-5']), history: [queued, ...HISTORY] }),
    busy: forgejo({
      current: current([[queued, [job(1, 'test', 'queued', null, null, false)]]], ['ABC-5']),
      history: [queued, ...HISTORY],
      busy: { repository: 'john/demo', number: 12, url: 'https://forgejo.example.com/john/demo/actions/runs/12' },
    }),
    nottaken: forgejo({ current: current([[untaken, [notTakenJob]]], ['ABC-5']), history: [untaken, ...HISTORY] }),
    fixed: forgejo({ current: current([[FIX_RUN, [job(1, 'test', 'success', 900, 180, false)]]], []), history: [FIX_RUN, ...HISTORY] }),
    mirror: finished,
    push: { ...finished, pushed: { commit: '5c95521730bbc58ab20052f7ff807c29a8fbeb65', at: ago(40) } },
    error: { ...finished, health: 'error', error: notice('ci.unreachable', { ci: 'Forgejo' }, { detail: 'connect ETIMEDOUT 100.64.0.1:443' }), checkedAt: ago(30) },
    off: { ...forgejo(), health: 'off', error: notice('ci.noToken', { kind: 'forgejo' }), checkedAt: null, current: null, history: [], medians: {} },
  }
  return { ABC: [views[kind ?? ''] ?? forgejo(), githubView(kind === 'mirror')], DEMO: [finished] }
}
