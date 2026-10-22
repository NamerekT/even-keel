import type { Git } from '../git/types.js'
import { englishOf, notice, noticeOf, sameNotice } from '../notice/notice.js'
import { currentRunOf, isFinished, medianDuration, taskIdsOf, type CiRun, type CiSource, type CiView, type CurrentRun } from './model.js'
import type { CiTarget } from './remote.js'
import { logTail, type FailedRun } from './report.js'

/** How often an unfinished run or a fresh push is polled. */
export const POLL_MS = 15_000
/** How long after a push the CI is polled for a run to take it. */
export const PUSH_WINDOW_MS = 10 * 60_000
export const ERROR_RETRY_MS = 60_000
export const HISTORY = 10
/** A run's tasks come from at most this many commits since the previous run. */
const TASK_COMMITS = 50

export interface CiWatchDeps {
  target: CiTarget
  /** `null` — no profile has a token for it. */
  source: CiSource | null
  git: Git
  repo: string
  /** The project's main branch, read at each look; `main` without it. */
  main?: () => string
  now?: () => Date
  log: (message: string) => void
  onChange: () => void
}

// One CI of one repository. A push is seen locally: `git push` and `git fetch` move `refs/remotes/<remote>/<main branch>`,
// so the API is asked only at the start, while a run is unfinished and for a while after a push.
export class CiWatch {
  view: CiView
  private head: string | null | undefined
  private polledAt = -Infinity
  private jobsOf: string | null = null
  private tasksOf: { run: number; tasks: string[] } | null = null
  private busy = false
  private source: CiSource | null

  constructor(private readonly deps: CiWatchDeps) {
    const { kind, remote, web, owner, repo } = deps.target
    this.source = deps.source
    this.view = {
      kind,
      remote,
      url: `${web}/${owner}/${repo}/actions`,
      health: deps.source === null ? 'off' : 'ok',
      error: deps.source === null ? notice('ci.noToken', { kind }) : null,
      checkedAt: null,
      current: null,
      history: [],
      medianMs: null,
      pushed: null,
    }
  }

  /**
   * A CI no profile's token reaches — none at all, or the API refuses it or does not show the repository — is not shown
   * and does not judge a main: GitHub Actions since BTN-200, Forgejo since BTN-201.
   */
  get hidden(): boolean {
    if (this.source === null) return true
    const error = this.view.health === 'error' ? this.view.error : null
    return error?.code === 'ci.denied' || (error?.code === 'ci.http' && (error.params as { status: number }).status === 404)
  }

  /** The token changed: a new source is asked at the next tick, `null` turns the watch off. */
  setSource(source: CiSource | null): void {
    this.source = source
    this.polledAt = -Infinity
    this.view.checkedAt = null
    this.view.health = source === null ? 'off' : 'ok'
    this.view.error = source === null ? notice('ci.noToken', { kind: this.deps.target.kind }) : null
    this.deps.onChange()
  }

  async tick(): Promise<void> {
    const source = this.source
    if (source === null || this.busy) return
    this.busy = true
    try {
      const now = this.now()
      const pushed = await this.readHead(now)
      if (!pushed && !this.due(now)) return
      this.polledAt = now.getTime()
      const before = JSON.stringify(this.view)
      await this.poll(source, now)
      if (JSON.stringify(this.view) !== before) this.deps.onChange()
    } finally {
      this.busy = false
    }
  }

  /** A failed run with its jobs and the log tail of its first failed job, for the fix task; what cannot be read stays `null`. */
  async failed(run: CiRun): Promise<FailedRun> {
    const source = this.source
    const failed: FailedRun = { kind: this.view.kind, run, jobs: null, log: null }
    if (source === null) return failed
    const current = this.view.current
    try {
      failed.jobs = current?.run.id === run.id && current.run.status === run.status ? current.jobs : await source.jobs(run)
      const job = failed.jobs.find((each) => each.status === 'failure')
      if (job !== undefined && source.log !== undefined) failed.log = logTail(await source.log(job))
    } catch (error) {
      this.deps.log(`ci: ${this.deps.target.remote} of ${this.deps.repo}: run ${run.number} is reported without its ${failed.jobs === null ? 'jobs' : 'log'}: ${englishOf(noticeOf(error))}`)
    }
    return failed
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  /** Whether the remote's main moved since the last look; the first look is not a push. */
  private async readHead(now: Date): Promise<boolean> {
    const main = this.deps.main?.() ?? 'main'
    const read = await this.deps.git(this.deps.repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/${this.deps.target.remote}/${main}`])
    const head = read.code === 0 ? read.out.trim() : null
    const first = this.head === undefined
    const moved = !first && head !== null && head !== this.head
    this.head = head
    if (moved) this.view.pushed = { commit: head, at: now.toISOString() }
    return moved
  }

  private due(now: Date): boolean {
    const since = now.getTime() - this.polledAt
    if (this.view.checkedAt === null && this.view.health !== 'error') return true
    if (this.view.health === 'error') return since >= ERROR_RETRY_MS
    const running = this.view.current !== null && !isFinished(this.view.current.run.status)
    const waiting = this.view.pushed !== null && now.getTime() - Date.parse(this.view.pushed.at) < PUSH_WINDOW_MS
    return (running || waiting) && since >= POLL_MS
  }

  private async poll(source: CiSource, now: Date): Promise<void> {
    try {
      const runs = await source.runs(HISTORY)
      const run = currentRunOf(runs)
      this.view.current = run === null ? null : await this.currentOf(source, run, runs)
      this.view.history = runs
      this.view.medianMs = medianDuration(runs, now)
      const pushed = this.view.pushed
      if (pushed !== null && runs.some((each) => each.commit === pushed.commit || Date.parse(each.createdAt) >= Date.parse(pushed.at))) {
        this.view.pushed = null
      }
      this.view.health = 'ok'
      this.view.error = null
    } catch (error) {
      const failure = noticeOf(error)
      if (this.view.health !== 'error' || !sameNotice(this.view.error, failure)) {
        this.deps.log(`ci: ${this.deps.target.remote} of ${this.deps.repo}: ${englishOf(failure)}`)
      }
      this.view.health = 'error'
      this.view.error = failure
    }
    this.view.checkedAt = now.toISOString()
  }

  private async currentOf(source: CiSource, run: CiRun, runs: CiRun[]): Promise<CurrentRun> {
    const key = `${run.id}:${run.status}`
    const known = this.view.current?.run.id === run.id ? this.view.current.jobs : []
    const jobs = this.jobsOf === key && isFinished(run.status) ? known : await source.jobs(run)
    this.jobsOf = key
    if (this.tasksOf?.run !== run.id) this.tasksOf = { run: run.id, tasks: await this.tasksFor(run, runs) }
    return { run, tasks: this.tasksOf.tasks, jobs }
  }

  /** The ids in the subjects of the commits since the commit of the previous run. */
  private async tasksFor(run: CiRun, runs: CiRun[]): Promise<string[]> {
    const previous = runs.slice(runs.indexOf(run) + 1).find((each) => each.commit !== run.commit)
    const range = previous === undefined ? ['-1', run.commit] : [`-${TASK_COMMITS}`, `${previous.commit}..${run.commit}`]
    const log = await this.deps.git(this.deps.repo, ['log', '--format=%s', ...range])
    return log.code === 0 ? taskIdsOf(log.out.split('\n')) : []
  }
}
