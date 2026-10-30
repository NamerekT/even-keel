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
}

export interface CiRun {
  id: number
  number: number
  title: string
  workflow: string
  commit: string
  status: RunStatus
  createdAt: string
  /** When a runner took it; `null` — not yet, or the CI did not say. */
  startedAt: string | null
  stoppedAt: string | null
  url: string
}

/** The latest runs, newest first, the jobs of one run and a job's log. A branch scopes the project's main view; PR feedback omits it. */
export interface CiSource {
  runs(limit: number, branch?: string): Promise<CiRun[]>
  jobs(run: CiRun): Promise<CiJob[]>
  /** A job's plain-text log; absent — the CI does not give logs through its API. */
  log?(job: CiJob): Promise<string>
}

export interface CurrentRun {
  run: CiRun
  /** Task ids from the commits this run brought to its branch since the previous run. */
  tasks: string[]
  jobs: CiJob[]
}

/** One CI of a project for the page. */
export interface CiView {
  kind: CiKind
  /** The git remote the CI belongs to. */
  remote: string
  /** The repository's runs page. */
  url: string
  /** `off` — no token in the environment; `error` — the API did not answer. */
  health: 'ok' | 'error' | 'off'
  error: Notice | null
  checkedAt: string | null
  current: CurrentRun | null
  history: CiRun[]
  /** The median duration of the latest finished runs. */
  medianMs: number | null
  /** A commit pushed to the remote's main that no run has taken yet, and since when. */
  pushed: { commit: string; at: string } | null
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

/** Only runs that went to the end count: a cancelled or skipped run says nothing about the usual length. */
export function medianDuration(runs: CiRun[], now: Date): number | null {
  const lengths = runs
    .filter((run) => run.status === 'success' || run.status === 'failure')
    .map((run) => runDurationMs(run, now))
    .filter((ms): ms is number => ms !== null)
    .sort((a, b) => a - b)
  if (lengths.length === 0) return null
  const middle = Math.floor(lengths.length / 2)
  return lengths.length % 2 === 1 ? lengths[middle]! : Math.round((lengths[middle - 1]! + lengths[middle]!) / 2)
}

export function currentRunOf(runs: CiRun[]): CiRun | null {
  return runs.find((run) => !isFinished(run.status)) ?? runs[0] ?? null
}

/** What the CI is stuck on: a queued run or a pushed commit no run has taken for `STUCK_MS`. */
export function stuckSince(view: Pick<CiView, 'current' | 'pushed'>, now: Date): string | null {
  const run = view.current?.run
  if (run !== undefined && run.status === 'queued' && now.getTime() - Date.parse(run.createdAt) >= STUCK_MS) return run.createdAt
  if (view.pushed !== null && now.getTime() - Date.parse(view.pushed.at) >= STUCK_MS) return view.pushed.at
  return null
}

const TASK_ID = /\[([A-Z][A-Z0-9]*-\d+)\]/g

export function taskIdsOf(subjects: string[]): string[] {
  return [...new Set(subjects.flatMap((subject) => [...subject.matchAll(TASK_ID)].map((match) => match[1]!)))]
}
