import { englishOf, NoticeError, type Notice } from '../notice/notice.js'
import { isFixName } from './fix.js'
import type { ActiveChain, ChainState, DispatcherDeps } from './model.js'

/** Launch blocks Start and Resume go in paused on and the chain lifts by itself once they are gone (`cleared`). */
const SELF_CLEARING: readonly string[] = ['review.notReady', 'agent.copyMissing', 'chain.noTrackerMcp', 'chain.packagesNotReady']

/** What keeps a chain's new sessions from starting, and the pauses on it that lift by themselves. */
export class LaunchPauses {
  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly firstOf: (project: string, chain?: ActiveChain) => string | undefined,
  ) {}

  selfClearing(code: string): boolean {
    return SELF_CLEARING.includes(code)
  }

  /**
   * A pause because PR mode had nowhere to go ends by itself once it has: a remote or a token added (EKR-12); so does
   * one because sessions would not see their task, once a package brings the tracker's server or brief is on (BTN-656);
   * so does one on a model the account lacks, once the first task's model is one it has (BTN-679).
   */
  async cleared(chain: ActiveChain): Promise<boolean> {
    const error = chain.error
    const task = this.firstOf(chain.project, chain)
    const model = error?.code === 'chain.unknownModel'
    if (!model && !SELF_CLEARING.includes(error?.code ?? '')) return false
    if (this.block(chain.project, task) !== undefined) return false
    if (model && !(await this.modelFits(chain.project, task))) return false
    // The user may have resumed or stopped the chain while the model list was read.
    if (!chain.paused || chain.error !== error || !this.state.active.includes(chain)) return false
    chain.paused = false
    chain.error = null
    this.deps.log(`chain: ${chain.project} goes on: ${model ? `the account of ${task} has its model now` : 'its launch requirement is ready'}`)
    this.deps.save(this.state)
    return true
  }

  private async modelFits(project: string, task: string | undefined): Promise<boolean> {
    if (task === undefined || this.deps.modelBlock === undefined) return false
    try {
      return (await this.deps.modelBlock(project, task)) === undefined
    } catch (error) {
      this.deps.log(`chain: the model of ${task} was not checked: ${String(error)}`)
      return false
    }
  }

  /**
   * Start and Resume refuse while launches are blocked, except by PR mode with nowhere to go: then the chain waits
   * paused on `review.notReady` (or the other `SELF_CLEARING` codes), which `cleared` lifts by itself (BTN-316).
   * Unsupported OpenCode Copilot also admits a paused chain, but requires an explicit resume after the model or account
   * is changed.
   */
  admit(chain: ActiveChain): void {
    const reason = this.block(chain.project, this.firstOf(chain.project, chain))
    if (reason !== undefined && ![...SELF_CLEARING, 'chain.opencodeCopilot'].includes(reason.code)) throw new NoticeError(reason)
    chain.paused = reason !== undefined
    chain.error = reason ?? null
    if (reason !== undefined) this.deps.log(`chain: ${chain.project} paused: ${englishOf(reason)}`)
  }

  require(project: string, task?: string): void {
    const reason = this.block(project, task)
    if (reason !== undefined) throw new NoticeError(reason)
  }

  /**
   * What keeps a new session of the project from starting: the service's blocks, then a tracker its sessions would not
   * see, then a package only the user can make ready, which a fix session of a red main does not wait for.
   */
  block(project: string, task?: string): Notice | undefined {
    const packages = task !== undefined && isFixName(task) ? undefined : this.deps.packagesPause(project)
    return this.deps.blocked(project, task) ?? this.deps.trackerBlock(project) ?? packages
  }
}
