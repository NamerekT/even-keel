import type { Notice } from '../notice/notice.js'
import type { TaskLists } from './lists.js'
import type { MainCheck } from './maincheck.js'
import { newChain, type ActiveChain, type ChainState, type DispatcherDeps, type MainPush } from './model.js'

/** What the waits on main need of the dispatcher that runs the chains. */
export interface MainWaitHost {
  chainOf(project: string): ActiveChain | undefined
  halt(chain: ActiveChain, error: Notice): void
  /** The stopped session of a task a red fix leaves the paused chain with (`MainFix.giveBack`). */
  giveBack(chain: ActiveChain): void
}

// The chain's side of the CI of main (BTN-103): the verdicts settled on each tick, the launch held while a push of main
// waits for one, and the project's own check of a push no CI judged.
export class MainWait {
  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly main: MainCheck | null,
    private readonly lists: TaskLists,
    private readonly host: MainWaitHost,
  ) {}

  async settle(): Promise<void> {
    if (this.main === null) return
    const { changed, stops, fixes } = await this.main.settle(this.lists.listedOpen)
    for (const { project, notice } of stops) {
      let chain = this.host.chainOf(project)
      if (chain === undefined) {
        this.state.queue = this.state.queue.filter((key) => key !== project)
        chain = newChain(project)
        this.state.active.push(chain)
      }
      this.host.halt(chain, notice)
      this.host.giveBack(chain)
    }
    for (const project of fixes) {
      if (this.host.chainOf(project) === undefined && !this.state.queue.includes(project)) this.state.active.push({ ...newChain(project), fixOnly: true })
    }
    if (changed) this.deps.save(this.state)
  }

  /**
   * Whether the launch of `task` waits for the CI's verdict on main or for the project's `commands.afterGreen`;
   * with `ahead` the task's place is prepared meanwhile.
   */
  heldByMain(chain: ActiveChain, task: string, listed: string[], ahead = true): boolean {
    const after = this.main?.afterGreenRun(chain.project)
    const hold = this.main?.holds(chain.project, listed, this.lists.listedOpen) ?? null
    const wait: ActiveChain['ciWait'] =
      after !== undefined
        ? { ...after, after: true }
        : hold === null || hold === 'fix'
          ? undefined
          : { commit: hold.commit, since: hold.at, ...('by' in hold ? { by: hold.by } : {}) }
    if (chain.ciWait?.commit !== wait?.commit || chain.ciWait?.after !== wait?.after || chain.ciWait?.by !== wait?.by) {
      if (wait === undefined) delete chain.ciWait
      else chain.ciWait = wait
      this.deps.save(this.state)
    }
    if (wait !== undefined && ahead) this.main!.ahead(chain.project, task)
    return after !== undefined || hold !== null
  }

  /** Runs the project's check on a push of main no CI judged, in the place of `task`; false — the chain is stopped. */
  async checkMain(chain: ActiveChain, task: string, push: MainPush): Promise<boolean> {
    chain.ciWait = { commit: push.commit, since: this.deps.now().toISOString(), local: true }
    this.deps.save(this.state)
    const stop = await this.main!.checkLocally(chain.project, task, this.lists.listedOpen)
    delete chain.ciWait
    this.deps.save(this.state)
    if (stop === null) return true
    this.host.halt(chain, stop)
    return false
  }
}
