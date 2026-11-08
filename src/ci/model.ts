import type { Notice } from '../notice/notice.js'

export const CI_KINDS = ['forgejo', 'github', 'gitlab'] as const

export type CiKind = (typeof CI_KINDS)[number]

/** The profile a project chose for its remotes of each kind, for their CI and pull requests (BTN-231); none — the default. */
export type RemoteProfiles = Partial<Record<CiKind, string>>

export type RunStatus = 'queued' | 'running' | 'success' | 'failure' | 'cancelled' | 'skipped'

export interface CiStep {
  name: string
  status: RunStatus
  startedAt: string | null
  stoppedAt: string | null
}

export interface CiJob {
  id: number
  name: string
  status: RunStatus
  startedAt: string | null
  stoppedAt: string | null
  /** `null` — the CI does not give steps through its API (Forgejo); they are on the run's page. */
  steps: CiStep[] | null
  /** The CI gave the job up because no runner ever took it (GitHub Actions, BTN-761). */
  notTaken?: boolean
}

/** What started a run (BTN-828): a push, a pull request, a hand, a schedule or anything else. */
export type RunEvent = 'push' | 'pull' | 'manual' | 'schedule' | 'other'

export interface CiRun {
  id: number
  number: number
  title: string
  workflow: string
  commit: string
  status: RunStatus
  /** Absent — the CI did not say. */
  event?: RunEvent
  createdAt: string
  /** When a runner took it; `null` — not yet, or the CI did not say. */
  startedAt: string | null
  stoppedAt: string | null
  url: string
  /**
   * A failed run whose every unsuccessful job no runner took (BTN-761): it says nothing about the commit, which stays
   * unchecked rather than red. `CiWatch` sets it from the run's jobs; the adapters never do.
   */
  notTaken?: boolean
}

/** The latest runs, newest first, the jobs of one run and a job's log. A branch scopes the project's main view; PR feedback omits it. */
export interface CiSource {
  runs(limit: number, branch?: string): Promise<CiRun[]>
  jobs(run: CiRun): Promise<CiJob[]>
  /** A job's plain-text log; absent — the CI does not give logs through its API. */
  log?(job: CiJob): Promise<string>
  /**
   * Reruns only the run's failed jobs (BTN-846): the run keeps its id and ends anew, with a new `stoppedAt`.
   * Absent — the CI cannot rerun through its API.
   */
  rerun?(run: CiRun): Promise<void>
}

const EVENTS: Readonly<Record<string, RunEvent>> = {
  push: 'push',
  pull_request: 'pull',
  pull_request_target: 'pull',
  merge_request_event: 'pull',
  workflow_dispatch: 'manual',
  web: 'manual',
  api: 'manual',
  trigger: 'manual',
  schedule: 'schedule',
}

/** A run's event as GitHub and Forgejo (`event`) or GitLab (`source`) name it. */
export function eventOf(raw: string | null | undefined): RunEvent | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  return EVENTS[raw] ?? 'other'
}

/** The `event` field of a run, left out when the CI did not say. */
export function withEvent(raw: string | null | undefined): Pick<CiRun, 'event'> {
  const event = eventOf(raw)
  return event === undefined ? {} : { event }
}

export interface WorkflowRun {
  run: CiRun
  jobs: CiJob[]
}

/** The runs of the push the CI is at or was last at (BTN-828), one per workflow, newest first. */
export interface CurrentRun {
  commit: string
  /** The commit's subject; a run without a push is titled by its workflow. */
  title: string
  /** A run without a push — by hand, on a schedule: it is a push of its own, with no tasks. */
  manual: boolean
  /** Task ids from the commits this push brought to its branch since the previous one. */
  tasks: string[]
  runs: WorkflowRun[]
}

/** The run that holds the runner a queued run waits for: of the same repository, or of another one on the same host. */
export interface BusyRunner {
  /** `owner/repo`. */
  repository: string
  number: number
  url: string
}

/** One CI of a project for the page. */
export interface CiView {
  kind: CiKind
  /** The git remote the CI belongs to. */
  remote: string
  /** `owner/repo` on the CI's host. */
  repository: string
  /** Whether the project's `ci.kinds` name this CI: one not counted is shown but judges nothing. */
  counted: boolean
  /** The repository's runs page. */
  url: string
  /** `off` — no token in the environment; `error` — the API did not answer. */
  health: 'ok' | 'error' | 'off'
  error: Notice | null
  checkedAt: string | null
  current: CurrentRun | null
  history: CiRun[]
  /** The median duration of the latest finished runs of each workflow; a workflow with none has no key. */
  medians: Record<string, number>
  /** A commit pushed to the remote's main that no run has taken yet, and since when. */
  pushed: { commit: string; at: string } | null
  /** Set by the service for the page: who holds the runner (`busyRunner`); absent — nobody. */
  busy?: BusyRunner
}

/** A run or a push that sits this long without a runner means the CI does not take work. */
export const STUCK_MS = 2 * 60_000

export function isFinished(status: RunStatus): boolean {
  return status !== 'queued' && status !== 'running'
}

export function runDurationMs(run: CiRun, now: Date): number | null {
  const start = run.startedAt ?? (isFinished(run.status) ? run.createdAt : null)
  if (start === null) return null
  const end = run.stoppedAt === null ? now.getTime() : Date.parse(run.stoppedAt)
  return Math.max(0, end - Date.parse(start))
}

/** A failed run as it ended: a rerun keeps the run's id and ends with a new stop. */
export const failedKey = (run: CiRun): string => `${run.id}:${run.stoppedAt ?? ''}`

/** Whether a failed run's jobs show it failed only for want of a runner: no job really failed. */
export function failedUntaken(jobs: CiJob[]): boolean {
  const unsuccessful = jobs.filter((job) => job.status !== 'success' && job.status !== 'skipped')
  return unsuccessful.length > 0 && unsuccessful.every((job) => job.notTaken === true)
}

/** Only runs that went to the end count: a cancelled or skipped run, or one no runner took, says nothing about the usual length. */
export function medianDuration(runs: CiRun[], now: Date): number | null {
  const lengths = runs
    .filter((run) => (run.status === 'success' || run.status === 'failure') && run.notTaken !== true)
    .map((run) => runDurationMs(run, now))
    .filter((ms): ms is number => ms !== null)
    .sort((a, b) => a - b)
  if (lengths.length === 0) return null
  const middle = Math.floor(lengths.length / 2)
  return lengths.length % 2 === 1 ? lengths[middle]! : Math.round((lengths[middle - 1]! + lengths[middle]!) / 2)
}

/** The median of each workflow's own runs (BTN-828): a quick workflow and a slow one beside it have nothing usual in common. */
export function mediansOf(runs: CiRun[], now: Date): Record<string, number> {
  const medians: Record<string, number> = {}
  for (const workflow of new Set(runs.map((run) => run.workflow))) {
    const median = medianDuration(runs.filter((run) => run.workflow === workflow), now)
    if (median !== null) medians[workflow] = median
  }
  return medians
}

export function currentRunOf(runs: CiRun[]): CiRun | null {
  return runs.find((run) => !isFinished(run.status)) ?? runs[0] ?? null
}

/** The runs of one push, or one run without a push (BTN-828), newest first. */
export interface PushRuns {
  key: string
  commit: string
  title: string
  manual: boolean
  runs: CiRun[]
}

/** A push or a pull request runs every workflow on its commit; a run by hand or on a schedule stands alone. */
const isManual = (run: CiRun): boolean => run.event === 'manual' || run.event === 'schedule' || run.event === 'other'

export const pushKey = (run: CiRun): string => (isManual(run) ? `run:${run.id}` : `push:${run.commit}`)

/** The runs grouped by push, in the order of each push's newest run. */
export function pushesOf(runs: CiRun[]): PushRuns[] {
  const pushes = new Map<string, PushRuns>()
  for (const run of runs) {
    const key = pushKey(run)
    const known = pushes.get(key)
    if (known !== undefined) known.runs.push(run)
    else pushes.set(key, { key, commit: run.commit, title: isManual(run) ? run.workflow : run.title, manual: isManual(run), runs: [run] })
  }
  return [...pushes.values()]
}

/** A run's own state on the page: a failure no runner took is `notTaken` (BTN-761). */
export type RunLook = RunStatus | 'notTaken'

export const runLook = (run: CiRun): RunLook => (run.status === 'failure' && run.notTaken === true ? 'notTaken' : run.status)

/** The state of a push's runs together, as the verdict reads them: a red run decides, then one at work, then the queue. */
const PUSH_ORDER: RunLook[] = ['failure', 'running', 'queued', 'notTaken', 'success', 'cancelled', 'skipped']

export function pushStatus(runs: CiRun[]): RunLook {
  const looks = new Set(runs.map(runLook))
  return PUSH_ORDER.find((look) => looks.has(look)) ?? 'skipped'
}

/**
 * The run the push's state and time follow (BTN-828): the verdict waits for the one that ends last — among those still
 * going, the longest by its workflow's median or its time so far; once all are over, the longest.
 */
export function leadRun(runs: CiRun[], medians: Readonly<Record<string, number>>, now: Date): CiRun {
  const going = runs.filter((run) => !isFinished(run.status))
  const length = (run: CiRun) => runDurationMs(run, now) ?? 0
  const expected = (run: CiRun) => (going.length > 0 ? Math.max(medians[run.workflow] ?? 0, length(run)) : length(run))
  return (going.length > 0 ? going : runs).reduce((lead, run) => (expected(run) > expected(lead) ? run : lead))
}

/** What the CI is stuck on: a queued run no busy runner explains, or a pushed commit no run has taken for `STUCK_MS`. */
export function stuckSince(view: Pick<CiView, 'current' | 'pushed' | 'busy'>, now: Date): string | null {
  const queued = view.busy === undefined ? (view.current?.runs ?? []).map((each) => each.run).filter((run) => run.status === 'queued') : []
  const stuck = queued.find((run) => now.getTime() - Date.parse(run.createdAt) >= STUCK_MS)
  if (stuck !== undefined) return stuck.createdAt
  if (view.pushed !== null && now.getTime() - Date.parse(view.pushed.at) >= STUCK_MS) return view.pushed.at
  return null
}

const TASK_ID = /\[([A-Z][A-Z0-9]*-\d+)\]/g

export function taskIdsOf(subjects: string[]): string[] {
  return [...new Set(subjects.flatMap((subject) => [...subject.matchAll(TASK_ID)].map((match) => match[1]!)))]
}
