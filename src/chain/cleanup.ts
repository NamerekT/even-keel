import { isOwnName } from './fix.js'
import { isNetworkFailure } from '../git/sync.js'
import type { FinishOutcome } from '../git/types.js'
import { englishOf, notice, noticeOf, type Notice } from '../notice/notice.js'
import type { MainCheck } from './maincheck.js'
import type { ActiveChain, ChainState, DispatcherDeps, PullCleanup } from './model.js'
import type { Reviews } from './reviews.js'

/** The waits before each next try of a sync of main that could not reach a remote: three tries in all (BTN-267). */
const SYNC_RETRY_MS = [30_000, 120_000]

/** A sync of main after a done task that could not reach a remote, awaiting its next try. */
interface SyncRetry {
  project: string
  task: string
  /**
   * The machine whose cleanup failed to sync (`FinishOutcome.machine`): its main holds the commits, so it gets the
   * tries. One that went off the link mid-cleanup is waited for, its tries not counted until it is back (BTN-995).
   */
  machine?: string
  /** The tree the check before the task's merge reported, for the verdict once main is pushed (`MainCheck.reportedTree`). */
  tree: string | null
  /** The tries after the cleanup's own one. */
  tries: number
  /** When the next try is due, ms. */
  due: number
  /** What the last try failed with. */
  error?: Notice
}

const retryKey = (project: string, machine: string | undefined): string => `${project}\0${machine ?? ''}`

/** A sync that may go through later: a remote out of reach, or a machine that went off the link mid-sync (BTN-995). */
const retryable = (error: Notice): boolean => isNetworkFailure(error) || error.code === 'machine.lockLost'

/** The cleanup after tasks the chain no longer leads: released ones once they are done, and ones whose pull request was closed. */
export class Cleanups {
  /** The project's released tasks the tracker says are done, awaiting their cleanup. */
  readonly done = new Map<string, Set<string>>()
  /**
   * By project and machine (`retryKey`). In memory: the chain goes on meanwhile, the next cleanup's sync on the same
   * machine takes the place of one awaiting its try, and after a restart the sync of the next done task there pushes
   * what this one could not.
   */
  private readonly syncRetries = new Map<string, SyncRetry>()

  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly main: MainCheck | null,
    private readonly reviews: Reviews,
  ) {}

  released(project: string): string[] {
    return [...(this.state.released[project] ?? [])]
  }

  keepReleased(project: string, released: string[]): void {
    if (released.length === 0) delete this.state.released[project]
    else this.state.released[project] = released
    const shelved = this.state.shelved[project]?.filter((each) => released.includes(each.task)) ?? []
    if (shelved.length === 0) delete this.state.shelved[project]
    else this.state.shelved[project] = shelved
    const done = this.done.get(project)
    for (const id of done ?? []) if (!released.includes(id)) done!.delete(id)
  }

  async sweep(): Promise<void> {
    await this.retrySyncs()
    for (const [project, done] of this.done) {
      for (const task of done) {
        if (this.working(task)) continue
        await this.closeUp(project, task)
        this.keepReleased(project, this.released(project).filter((id) => id !== task))
        this.deps.save(this.state)
      }
    }
  }

  /** Whether a done task's session holds its cleanup: a session whose turn ended on a background command does not. */
  working(task: string): boolean {
    return this.deps.machine.busy(task) && !this.deps.machine.shell(task)
  }

  /** Cleans up after a done task and, once main is pushed, awaits the CI's verdict on it. */
  async closeUp(project: string, task: string): Promise<void> {
    const tree = this.main?.reportedTree(project, task) ?? null
    const outcome = await this.cleanUp(project, task, this.reviews.cleanupOf(project, task))
    this.reviews.closedUp(project, task)
    this.syncRetries.delete(retryKey(project, outcome.machine))
    if (outcome.syncError !== null && retryable(outcome.syncError)) {
      this.keepOutcome(project, task, { warnings: outcome.warnings, syncError: null })
      const machine = outcome.machine === undefined ? {} : { machine: outcome.machine }
      this.retrySync({ project, task, tree, tries: 0, due: 0, ...machine }, outcome.syncError)
      return
    }
    this.keepOutcome(project, task, outcome)
    if (outcome.syncError === null) await this.main?.pushed(project, task, tree, outcome)
  }

  /** The machine of the retry is off the link now and not revoked: its tries wait for it. */
  private awayFrom(retry: SyncRetry): boolean {
    const machines = this.deps.machines
    if (machines === undefined || retry.machine === undefined || retry.machine === machines.own()) return false
    if (machines.gone?.(retry.machine) === true) return false
    return !machines.list().some(({ id }) => id === retry.machine)
  }

  /**
   * Tries again the syncs of main that could not reach a remote, once each is due. The last failed try, or one the remote
   * refused, becomes the cleanup's warning; one that goes through is pushed as the cleanup would have pushed it.
   */
  private async retrySyncs(): Promise<void> {
    for (const [key, retry] of this.syncRetries) {
      const { project } = retry
      if (this.deps.now().getTime() < retry.due || this.awayFrom(retry)) continue
      if (retry.machine !== undefined && this.deps.machines?.gone?.(retry.machine) === true) {
        this.syncRetries.delete(key)
        this.deps.log(`git: sync of ${project} after ${retry.task} is not tried again: machine ${retry.machine} was revoked`)
        this.keepOutcome(project, retry.task, { warnings: [], syncError: retry.error ?? notice('machine.lockLost', { command: 'sync' }) })
        this.deps.save(this.state)
        continue
      }
      retry.tries++
      let error: Notice | null
      try {
        error = await this.deps.machine.sync(project, retry.machine)
      } catch (failure) {
        error = noticeOf(failure)
      }
      if (error === null) {
        this.syncRetries.delete(key)
        this.deps.log(`git: sync of ${project} after ${retry.task} went through on try ${retry.tries + 1}`)
        await this.main?.pushed(project, retry.task, retry.tree, retry.machine === undefined ? {} : { machine: retry.machine })
      } else if (retryable(error) && (error.code === 'machine.lockLost' || retry.tries < SYNC_RETRY_MS.length)) {
        if (error.code === 'machine.lockLost') retry.tries--
        this.retrySync(retry, error)
      } else {
        this.syncRetries.delete(key)
        this.deps.log(`git: sync of ${project} after ${retry.task} failed on try ${retry.tries + 1}: ${englishOf(error)}`)
        this.keepOutcome(project, retry.task, { warnings: [], syncError: error })
        this.deps.save(this.state)
      }
    }
  }

  private retrySync(retry: SyncRetry, error: Notice): void {
    const wait = SYNC_RETRY_MS[retry.tries]!
    retry.due = this.deps.now().getTime() + wait
    retry.error = error
    this.syncRetries.set(retryKey(retry.project, retry.machine), retry)
    const failed = retry.tries === 0 ? 'failed' : `failed on try ${retry.tries + 1}`
    this.deps.log(`git: sync of ${retry.project} after ${retry.task} ${failed}, trying again in ${wait / 1000} s: ${englishOf(error)}`)
  }

  /** A task whose pull request was closed unmerged: its place and branch go, main is not pushed, the task stays open. */
  async dropUnmerged(project: string, task: string, pull: PullCleanup): Promise<void> {
    this.keepOutcome(project, task, await this.cleanUp(project, task, pull))
    this.keepReleased(project, this.released(project).filter((id) => id !== task))
  }

  private async cleanUp(project: string, task: string, pull?: PullCleanup): Promise<FinishOutcome> {
    try {
      if (!isOwnName(task) && pull?.unmerged !== true) this.deps.archiveClosed?.(project, task)
      return await (pull === undefined ? this.deps.machine.finish(project, task) : this.deps.machine.finish(project, task, pull))
    } catch (error) {
      return { warnings: [notice('cleanup.failed', {}, { cause: noticeOf(error) })], syncError: null }
    }
  }

  private keepOutcome(project: string, task: string, outcome: FinishOutcome): void {
    const sync = outcome.syncError === null ? [] : [notice('cleanup.syncFailed', {}, { cause: outcome.syncError })]
    const warnings = [...outcome.warnings, ...sync]
    if (warnings.length === 0) return
    const at = this.deps.now().toISOString()
    const leftovers = (this.state.leftovers[project] ??= [])
    leftovers.push(...warnings.map((notice) => ({ task, at, notice })))
  }

  /**
   * Closes the task the chain left as `closing`: `done` — it is done by the tracker's last read, `quietTooLong` — its
   * session, still working, has been quiet long enough to be left to the sweep. `false` — the chain waits.
   */
  async finish(chain: ActiveChain, task: string, done: boolean, quietTooLong: () => boolean): Promise<boolean> {
    if (!done) {
      delete chain.closing
      this.deps.save(this.state)
      return true
    }
    if (this.working(task)) {
      if (!quietTooLong()) return false
      delete chain.closing
      const released = (this.state.released[chain.project] ??= [])
      if (!released.includes(task)) released.push(task)
      this.deps.save(this.state)
      return true
    }
    await this.closeUp(chain.project, task)
    delete chain.closing
    this.deps.save(this.state)
    return true
  }

  /** A warning about a finished task's cleanup that came after the cleanup itself: a stop tried again in vain (EKR-99). */
  leftover(project: string, task: string, warning: Notice): void {
    const leftovers = (this.state.leftovers[project] ??= [])
    leftovers.push({ task, at: this.deps.now().toISOString(), notice: warning })
    this.deps.save(this.state)
  }

  dismiss(project: string, task: string): void {
    const leftovers = this.state.leftovers[project]
    if (leftovers === undefined || !leftovers.some((each) => each.task === task)) return
    const kept = leftovers.filter((each) => each.task !== task)
    if (kept.length === 0) delete this.state.leftovers[project]
    else this.state.leftovers[project] = kept
    this.deps.save(this.state)
  }
}
