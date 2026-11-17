import { englishOf, fail, noticeOf } from '../notice/notice.js'
import type { SilentRestart } from '../sessions/silence.js'
import { acceptable, answerable } from './answers.js'
import type { TaskMoves as Handovers } from '../machine/tasks.js'
import { requireLimit } from './limitNotice.js'
import type { ActiveChain, ChainState, CurrentTask, DispatcherDeps } from './model.js'
import type { LaunchPauses } from './pauses.js'
import type { HandoffSession } from './relay.js'
import { guardRestart } from './restartGuard.js'
import type { Unchanged } from './unchanged.js'

export interface TalkHost {
  /** The project's head lane; with `task` — the lane holding it, else the head. */
  chainOf: (project: string, task?: string) => ActiveChain | undefined
  requireProject: (project: string) => void
  /** The task is done by the tracker's last read. */
  done: (project: string, task: string) => boolean
  /** The dispatcher's work in turn: what the user asks for runs after the step under way. */
  work: () => Promise<void>
  setWork: (next: Promise<void>) => void
}

/** What the user does to the session of a chain's task from the page: a new session, an answer, "Accept as answer". */
export class Talks {
  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly handovers: Handovers,
    private readonly unchanged: Unchanged,
    private readonly pauses: LaunchPauses,
    private readonly host: TalkHost,
  ) {}

  restart(project: string, task: string, confirmed?: SilentRestart): void {
    this.host.requireProject(project)
    const chain = this.host.chainOf(project, task)
    const current = chain?.current?.task === task ? chain.current : null
    if (chain === undefined || current === null) throw fail('chain.notCurrent', { task })
    if (current.sessionId === null) throw fail('chain.launching', { task })
    guardRestart(this.deps, task, current.sessionId, confirmed)
    this.pauses.require(project, task)
    requireLimit(this.deps, project, task)
    const session = this.deps.machine.handoff(task)
    if (session === undefined) throw fail('chain.noSession', { task })
    const replaced = current.sessionId
    this.host.setWork(this.host.work().then(() => {
      try {
        guardRestart(this.deps, task, replaced, confirmed)
      } catch (error) {
        console.warn(englishOf(noticeOf(error)))
        return
      }
      this.unhold(chain)
      return this.handovers.replace(chain, current, replaced, session)
    }))
  }

  /**
   * Throws unless the user may answer the session now: it is the current one of the task — of its chain or, once
   * the chain stopped, the one that lives on — waits rather than works, and still waits on the question `ask`
   * (`null` — on none, the turn ended in plain text). With `takes` — the session takes a message mid-turn, by its
   * mailbox (BTN-181) or straight in (BTN-291) — a plain message to a working session passes as `midTurn`: nothing is
   * launched.
   */
  answerable(
    project: string,
    task: string,
    sessionId: string,
    ask: string | null,
    takes = false,
  ): { chain: ActiveChain | null; current: CurrentTask | null; session: HandoffSession; midTurn: boolean } {
    return answerable(this.state, this.deps, project, task, sessionId, ask, takes)
  }

  /** Invariant 1, exception 6: queues the user's answer and resolves to whether it reached the session. */
  answer(project: string, task: string, sessionId: string, ask: string | null, prompt: string): Promise<boolean> {
    const { chain, current, session } = this.answerable(project, task, sessionId, ask)
    const delivery = this.host.work().then(() => {
      if (chain === null || current === null) return this.handovers.deliverLoose(project, task, session, prompt)
      this.unhold(chain)
      return this.handovers.deliver(chain, current, session, prompt, ask)
    })
    this.host.setWork(delivery.then(() => {}))
    return delivery
  }

  /**
   * Invariant 1, exceptions 2 and 6 (BTN-757): the user's answer to a waiting session whose cache went cold starts a new
   * session with the handoff and the answer instead of resuming the old one. Only for the current task of a running chain.
   */
  renew(project: string, task: string, sessionId: string, ask: string | null, prompt: string): void {
    const { chain, current, session } = this.answerable(project, task, sessionId, ask)
    if (chain === null || current === null) throw fail('chain.notCurrent', { task })
    this.pauses.require(project, task)
    this.host.setWork(this.host.work().then(() => {
      this.unhold(chain)
      return this.handovers.renew(chain, current, session, prompt)
    }))
  }

  /** "Accept as answer" (BTN-885): resolves once the task is done in the tracker, rejects with why it was not. */
  async accept(project: string, task: string, sessionId: string): Promise<void> {
    const check = () => {
      // A second press while the first one's Done waits for its cleanup would comment the answer twice.
      if (this.host.done(project, task)) throw fail('accept.closed', { task })
      return acceptable(this.state, this.deps, project, task, sessionId)
    }
    check()
    // Checked again in turn: a step before it may have moved the session on.
    const accepted = this.host.work().then(() => {
      const { chain, current, session, message } = check()
      return this.unchanged.accept(chain, current, session, message)
    })
    this.host.setWork(accepted.catch(() => undefined))
    return accepted
  }

  /** A pause for the user to tell the session of a mark refused what to do ends once they do: its next mark opens at once. */
  unhold(chain: ActiveChain): void {
    if (!chain.paused || chain.error?.code !== 'review.notOpened') return
    chain.paused = false
    chain.error = null
  }
}
