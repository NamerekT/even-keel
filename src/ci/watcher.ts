import type { Git } from '../git/types.js'
import { englishOf, fail, notice, noticeOf, sameNotice } from '../notice/notice.js'
import { currentRunOf, failedKey, failedUntaken, isFinished, medianDuration, taskIdsOf, type CiJob, type CiRun, type CiSource, type CiView, type CurrentRun } from './model.js'
import type { CiTarget } from './remote.js'
import { readFailure, type FailedRun } from './report.js'
import { CI_TITLES } from './verdict.js'

/** How often an unfinished run or a fresh push is polled. */
export const POLL_MS = 15_000
/** How long after a push the CI is polled for a run to take it. */
export const PUSH_WINDOW_MS = 10 * 60_000
export const ERROR_RETRY_MS = 60_000
/** How long one `want` keeps a finished history polled: the chain asks again on each of its steps while it waits. */
export const WANT_MS = 2 * 60_000
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
  /**
   * Whether the project counts this CI (`ci.kinds`), read at each look; counted without it. A push an uncounted CI
   * takes no run for is polled for but not shown as waiting (BTN-707): its workflow may run only by hand.
   */
  counted?: () => boolean
  now?: () => Date
  log: (message: string) => void
  onChange: () => void
  /** The CI answers again after an error: the profile whose token it takes is checked again (BTN-678). */
  onRecovered?: () => void
}

// One CI of one repository. A push is seen locally: `git push` and `git fetch` move `refs/remotes/<remote>/<main branch>`,
// so the API is asked only at the start, while a run is unfinished and for a while after a push.
export class CiWatch {
  view: CiView
  private head: string | null | undefined
  /** The push no run has taken yet, shown or not: the CI is polled for it during the push window. */
  private push: { commit: string; at: string } | null = null
  private branch: string | undefined
  private polledAt = -Infinity
  private wantedAt = -Infinity
  private jobsOf: string | null = null
  private tasksOf: { run: number; tasks: string[] } | null = null
  /** The jobs of each failed run, read once to tell a run no runner took (BTN-761); by `failedKey`. */
  private readonly failedJobs = new Map<string, CiJob[]>()
  /** The failed runs whose jobs could not be read, logged once each. */
  private readonly unread = new Set<string>()
  private busy = false
  private source: CiSource | null

  constructor(private readonly deps: CiWatchDeps) {
    const { kind, remote, web, owner, repo } = deps.target
    this.source = deps.source
    this.view = {
      kind,
      remote,
      url: `${web}/${owner}/${repo}/${kind === 'gitlab' ? '-/pipelines' : 'actions'}`,
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
   * and does not judge a main, for every forge.
   */
  get hidden(): boolean {
    if (this.source === null) return true
    const error = this.view.health === 'error' ? this.view.error : null
    return error?.code === 'ci.denied' || (error?.code === 'ci.http' && (error.params as { status: number }).status === 404)
  }

  /** The remote's main this watch last read; `null` — not read yet or missing. */
  get remoteHead(): string | null {
    return this.head ?? null
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

  /**
   * The chain waits for a fresh verdict on a commit whose runs are over — a red one the fix session reran (EKR-88):
   * no push and no run under way would poll for it, so the history is polled for `WANT_MS` after the last call.
   */
  want(): void {
    this.wantedAt = this.now().getTime()
  }

  async tick(): Promise<void> {
    const source = this.source
    if (source === null || this.busy) return
    this.busy = true
    try {
      const now = this.now()
      const branch = this.deps.main?.() ?? 'main'
      if (branch !== this.branch) {
        this.branch = branch
        this.head = undefined
        this.polledAt = -Infinity
        this.jobsOf = null
        this.tasksOf = null
        this.failedJobs.clear()
        this.push = null
        this.view = { ...this.view, checkedAt: null, current: null, history: [], medianMs: null, pushed: null }
      }
      const pushed = await this.readHead(now, branch)
      const shown = this.counted() ? this.push : null
      if (this.view.pushed !== shown) {
        this.view.pushed = shown
        this.deps.onChange()
      }
      if (!pushed && !this.due(now)) return
      this.polledAt = now.getTime()
      const before = JSON.stringify(this.view)
      await this.poll(source, now, branch)
      if (JSON.stringify(this.view) !== before) this.deps.onChange()
    } finally {
      this.busy = false
    }
  }

  get rerunnable(): boolean {
    return this.source?.rerun !== undefined
  }

  /**
   * Reruns the failed jobs of a run (BTN-846) and polls the history at once and then for `WANT_MS`, for the run
   * under way again. Throws `ci.rerunUnsupported` for a CI without a rerun, a CI's own error otherwise.
   */
  async rerun(run: CiRun): Promise<void> {
    const source = this.source
    if (source?.rerun === undefined) throw fail('ci.rerunUnsupported', { ci: CI_TITLES[this.view.kind] })
    await source.rerun(run)
    this.polledAt = -Infinity
    this.want()
  }

  /** A failed run with its jobs and the log tail of its first failed job, for the fix task; what cannot be read stays `null`. */
  async failed(run: CiRun): Promise<FailedRun> {
    const source = this.source
    const failed: FailedRun = { kind: this.view.kind, run, jobs: null, log: null }
    if (source === null) return failed
    const current = this.view.current
    try {
      const known = current?.run.id === run.id && current.run.status === run.status ? current.jobs : this.failedJobs.get(failedKey(run))
      await readFailure(source, failed, known)
    } catch (error) {
      this.deps.log(`ci: ${this.deps.target.remote} of ${this.deps.repo}: run ${run.number} is reported without its ${failed.jobs === null ? 'jobs' : 'log'}: ${englishOf(noticeOf(error))}`)
    }
    return failed
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private counted(): boolean {
    return this.deps.counted?.() ?? true
  }

  /** Whether the remote's main moved since the last look; the first look is not a push. */
  private async readHead(now: Date, branch: string): Promise<boolean> {
    const read = await this.deps.git(this.deps.repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/${this.deps.target.remote}/${branch}`])
    const head = read.code === 0 ? read.out.trim() : null
    const first = this.head === undefined
    const moved = !first && head !== null && head !== this.head
    this.head = head
    if (moved) this.push = { commit: head, at: now.toISOString() }
    return moved
  }

  private due(now: Date): boolean {
    const since = now.getTime() - this.polledAt
    if (this.view.checkedAt === null && this.view.health !== 'error') return true
    if (this.view.health === 'error') return since >= ERROR_RETRY_MS
    const running = this.view.current !== null && !isFinished(this.view.current.run.status)
    const waiting = this.push !== null && now.getTime() - Date.parse(this.push.at) < PUSH_WINDOW_MS
    const wanted = now.getTime() - this.wantedAt < WANT_MS
    return (running || waiting || wanted) && since >= POLL_MS
  }

  private async poll(source: CiSource, now: Date, branch: string): Promise<void> {
    try {
      const read = await source.runs(HISTORY, branch)
      const run = currentRunOf(read)
      const current = run === null ? null : await this.currentOf(source, run, read)
      const runs = await this.markUntaken(source, read, current)
      this.view.current = current === null ? null : { ...current, run: runs.find((each) => each.id === current.run.id) ?? current.run }
      this.view.history = runs
      this.view.medianMs = medianDuration(runs, now)
      const pushed = this.push
      if (pushed !== null && runs.some((each) => each.commit === pushed.commit || Date.parse(each.createdAt) >= Date.parse(pushed.at))) {
        this.push = null
        this.view.pushed = null
      }
      if (this.view.health === 'error') {
        this.deps.log(`ci: ${this.deps.target.remote} of ${this.deps.repo} answers again`)
        this.deps.onRecovered?.()
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

  /**
   * The runs with `notTaken` set on each failed one whose jobs show no job really failed (BTN-761). A failed run's jobs
   * are read once, and again only when it ends anew; jobs that cannot be read leave the run failed until the next poll.
   */
  private async markUntaken(source: CiSource, runs: CiRun[], current: CurrentRun | null): Promise<CiRun[]> {
    const seen = new Set<string>()
    const marked: CiRun[] = []
    for (const run of runs) {
      if (run.status !== 'failure') {
        marked.push(run)
        continue
      }
      const key = failedKey(run)
      seen.add(key)
      const jobs = current?.run.id === run.id ? current.jobs : (this.failedJobs.get(key) ?? (await this.readJobs(source, run, key)))
      if (jobs !== null) this.failedJobs.set(key, jobs)
      marked.push(jobs !== null && failedUntaken(jobs) ? { ...run, notTaken: true } : run)
    }
    for (const known of [this.failedJobs, this.unread]) for (const key of known.keys()) if (!seen.has(key)) known.delete(key)
    return marked
  }

  private async readJobs(source: CiSource, run: CiRun, key: string): Promise<CiJob[] | null> {
    try {
      const jobs = await source.jobs(run)
      this.unread.delete(key)
      return jobs
    } catch (error) {
      if (!this.unread.has(key)) this.deps.log(`ci: ${this.deps.target.remote} of ${this.deps.repo}: the jobs of run ${run.number} are not read: ${englishOf(noticeOf(error))}`)
      this.unread.add(key)
      return null
    }
  }

  /** The ids in the subjects of the commits since the commit of the previous run. */
  private async tasksFor(run: CiRun, runs: CiRun[]): Promise<string[]> {
    const previous = runs.slice(runs.indexOf(run) + 1).find((each) => each.commit !== run.commit)
    const range = previous === undefined ? ['-1', run.commit] : [`-${TASK_COMMITS}`, `${previous.commit}..${run.commit}`]
    const log = await this.deps.git(this.deps.repo, ['log', '--format=%s', ...range])
    return log.code === 0 ? taskIdsOf(log.out.split('\n')) : []
  }
}
