import type { FinishOutcome } from '../git/types.js'
import { notice, noticeOf } from '../notice/notice.js'
import type { MainCheck } from './maincheck.js'
import type { ChainState, DispatcherDeps, PullCleanup } from './model.js'
import type { Reviews } from './reviews.js'

/** The cleanup after tasks the chain no longer leads: released ones once they are done, and ones whose pull request was closed. */
export class Cleanups {
  /** The project's released tasks the tracker says are done, awaiting their cleanup. */
  readonly done = new Map<string, Set<string>>()

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
    this.keepOutcome(project, task, outcome)
    if (outcome.syncError === null) await this.main?.pushed(project, task, tree)
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
