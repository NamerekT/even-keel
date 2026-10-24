import { fail } from '../notice/notice.js'
import type { ActiveChain, CarrySession, ChainState, CurrentTask, DispatcherDeps, FixOutcome, LaunchEntry } from './model.js'

// A release project's carry that git could not merge (BTN-369) is resolved by a session without a tracker task in the
// project it merges into: asked for on the release project's page, it goes after the current task of that project's
// chain, and is over once that project's branch has the release commit. The record is on the release project's gate in
// `ci`, so it outlives a restart; the carry's hold itself is `ForwardMerger`'s, which lifts it once nothing is behind.
export class MainCarry {
  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly host: { closeUp(project: string, task: string): Promise<void> },
  ) {}

  /** The carry the project's chain is to run, asked first. */
  due(project: string): CarrySession | undefined {
    return this.all().find(([, carry]) => carry.into === project)?.[1]
  }

  /** The release project's carry a session resolves or is about to. */
  of(from: string): CarrySession | undefined {
    return this.state.ci[from]?.carry
  }

  /** Records the carry asked for; `false` — the release project's carry is already asked for. */
  ask(from: string, carry: CarrySession): boolean {
    if (this.of(from) !== undefined) return false
    ;(this.state.ci[from] ??= {}).carry = carry
    this.deps.log(`chain: ${carry.into}: ${carry.task} resolves the carry of ${carry.commits} commit(s) after the current task`)
    return true
  }

  /**
   * The carry session leads the chain: `true` — it is over, the release commit is in the branch and the place cleaned
   * up, or the carry is no longer wanted. A session whose turn ended on a background command does not hold it.
   */
  async follow(chain: ActiveChain, current: CurrentTask): Promise<boolean> {
    const found = this.all().find(([, carry]) => carry.task === current.task && carry.into === chain.project)
    if (found === undefined) this.ended(chain, 'dropped', {})
    else {
      const [from, carry] = found
      if (this.deps.busy(current.task) && !this.deps.shell(current.task)) return false
      if (!(await this.deps.carried(chain.project, carry.commit).catch(() => false))) return false
      await this.host.closeUp(chain.project, carry.task)
      delete this.state.ci[from]!.carry
      this.ended(chain, 'carried', { commits: carry.commits })
    }
    chain.current = null
    this.deps.save(this.state)
    return true
  }

  /**
   * "Skip" on the carry session: the chain stops waiting for it and the carry stays held; the session is not touched.
   * A carry still waiting for its turn is taken back.
   */
  skip(chain: ActiveChain | undefined, name: string): void {
    const asked = this.all().find(([, carry]) => carry.task === name && carry.into === chain?.project)
    if (asked !== undefined && chain?.current?.task !== name) {
      delete this.state.ci[asked[0]]!.carry
      this.deps.save(this.state)
      this.deps.log(`chain: ${asked[1].into}: the carry ${name} is taken back before it started, the carry stays held`)
      return
    }
    if (chain === undefined || chain.current?.task !== name) throw fail('chain.notCurrent', { task: name })
    if (chain.current.sessionId === null) throw fail('chain.launching', { task: name })
    if (this.deps.busy(name)) throw fail('chain.midTurn', { task: name })
    const found = this.all().find(([, carry]) => carry.task === name)
    if (found !== undefined) delete this.state.ci[found[0]]!.carry
    this.ended(chain, 'dropped', {})
    chain.current = null
    this.deps.log(`chain: ${chain.project}: the carry session ${name} is skipped, the carry stays held`)
  }

  private all(): [string, CarrySession][] {
    return Object.entries(this.state.ci).flatMap(([from, gate]) => (gate.carry === undefined ? [] : [[from, gate.carry] as [string, CarrySession]]))
  }

  /** The launch log keeps how the carry ended, for its line in the chain's archive. */
  private ended(chain: ActiveChain, how: FixOutcome, extra: Pick<LaunchEntry, 'commits'>): void {
    const current = chain.current!
    this.deps.journal({ at: this.deps.now().toISOString(), project: chain.project, task: current.task, sessionId: current.sessionId ?? '', reason: how, ...extra })
  }
}
