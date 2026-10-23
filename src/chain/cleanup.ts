import { isNetworkFailure } from '../git/sync.js'
import type { FinishOutcome } from '../git/types.js'
import { englishOf, notice, noticeOf, type Notice } from '../notice/notice.js'
import type { MainCheck } from './maincheck.js'
import type { ChainState, DispatcherDeps, PullCleanup } from './model.js'
import type { Reviews } from './reviews.js'

/** The waits before each next try of a sync of main that could not reach a remote: three tries in all (BTN-267). */
const SYNC_RETRY_MS = [30_000, 120_000]

/** A sync of main after a done task that could not reach a remote, awaiting its next try. */
interface SyncRetry {
  task: string
  /** The task's tree, for the CI's verdict once main is pushed (`MainCheck.taskTree`). */
  tree: string | null
  /** The tries after the cleanup's own one. */
  tries: number
  /** When the next try is due, ms. */
  due: number
}

/** The cleanup after tasks the chain no longer leads: released ones once they are done, and ones whose pull request was closed. */
export class Cleanups {
  /** The project's released tasks the tracker says are done, awaiting their cleanup. */
  readonly done = new Map<string, Set<string>>()
  /**
   * By project. In memory: the chain goes on meanwhile, the next cleanup's sync takes the place of one awaiting its try,
   * and after a restart the sync of the next done task pushes what this one could not.
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
    return this.deps.busy(task) && !this.deps.shell(task)
  }

  /** Cleans up after a done task and, once main is pushed, awaits the CI's verdict on it. */
  async closeUp(project: string, task: string): Promise<void> {
    const tree = (await this.main?.taskTree(project, task)) ?? null
    const outcome = await this.cleanUp(project, task, this.reviews.cleanupOf(project, task))
    this.reviews.closedUp(project, task)
    this.syncRetries.delete(project)
    if (outcome.syncError !== null && isNetworkFailure(outcome.syncError)) {
      this.keepOutcome(project, task, { ...outcome, syncError: null })
      this.retrySync(project, { task, tree, tries: 0, due: 0 }, outcome.syncError)
      return
    }
    this.keepOutcome(project, task, outcome)
    if (outcome.syncError === null) await this.main?.pushed(project, task, tree)
  }

  /**
   * Tries again the syncs of main that could not reach a remote, once each is due. The last failed try, or one the remote
   * refused, becomes the cleanup's warning; one that goes through is pushed as the cleanup would have pushed it.
   */
  private async retrySyncs(): Promise<void> {
    for (const [project, retry] of this.syncRetries) {
      if (this.deps.now().getTime() < retry.due) continue
      retry.tries++
      let error: Notice | null
      try {
        error = await this.deps.sync(project)
      } catch (failure) {
        error = noticeOf(failure)
      }
      if (error === null) {
        this.syncRetries.delete(project)
        this.deps.log(`git: sync of ${project} after ${retry.task} went through on try ${retry.tries + 1}`)
        await this.main?.pushed(project, retry.task, retry.tree)
      } else if (isNetworkFailure(error) && retry.tries < SYNC_RETRY_MS.length) {
        this.retrySync(project, retry, error)
      } else {
        this.syncRetries.delete(project)
        this.deps.log(`git: sync of ${project} after ${retry.task} failed on try ${retry.tries + 1}: ${englishOf(error)}`)
        this.keepOutcome(project, retry.task, { warnings: [], syncError: error })
        this.deps.save(this.state)
      }
    }
  }

  private retrySync(project: string, retry: SyncRetry, error: Notice): void {
    const wait = SYNC_RETRY_MS[retry.tries]!
    retry.due = this.deps.now().getTime() + wait
    this.syncRetries.set(project, retry)
    const failed = retry.tries === 0 ? 'failed' : `failed on try ${retry.tries + 1}`
    this.deps.log(`git: sync of ${project} after ${retry.task} ${failed}, trying again in ${wait / 1000} s: ${englishOf(error)}`)
  }

  /** A task whose pull request was closed unmerged: its place and branch go, main is not pushed, the task stays open. */
  async dropUnmerged(project: string, task: string, pull: PullCleanup): Promise<void> {
    this.keepOutcome(project, task, await this.cleanUp(project, task, pull))
    this.keepReleased(project, this.released(project).filter((id) => id !== task))
  }

  private async cleanUp(project: string, task: string, pull?: PullCleanup): Promise<FinishOutcome> {
    try {
      return await (pull === undefined ? this.deps.finish(project, task) : this.deps.finish(project, task, pull))
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
}
