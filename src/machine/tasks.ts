import type { ActiveChain, ChainState, CurrentTask, DispatcherDeps, ReturnReason } from '../chain/model.js'
import type { HandoffReason, HandoffSession } from '../chain/relay.js'
import { noticeOf, type Notice } from '../notice/notice.js'
import { Handovers } from './handover.js'
import type { MoveDeps } from './host.js'
import { applyFields, fieldsOf, followDue, guardDue, type MoveCall, type MoveName, type MoveSaved, type MovesPort } from './move-call.js'
import { OverageStops } from './overage.js'

type Reason = 'restart' | 'message' | 'checkpoint' | 'review' | ReturnReason

/**
 * The moves of a task's session as the hub's chain asks for them (`docs/machines.md`, "Moves"): the limit, a
 * checkpoint, the user's answer, "New session", a returned task, the fix's handoff and the stop on paid usage.
 */
export interface TaskMoves {
  /** Stops the current session on paid usage; `false` — the chain paused on a failure and is not stepped now. */
  guard(chain: ActiveChain): Promise<boolean>
  follow(chain: ActiveChain, current: CurrentTask): Promise<void>
  deliver(chain: ActiveChain, current: CurrentTask, session: HandoffSession, prompt: string, ask: string | null, move?: 'answer' | 'review'): Promise<boolean>
  deliverLoose(project: string, task: string, session: HandoffSession, prompt: string): Promise<boolean>
  replace(chain: ActiveChain, current: CurrentTask, replaced: string, session: HandoffSession): Promise<void>
  renew(chain: ActiveChain, current: CurrentTask, session: HandoffSession, prompt: string): Promise<void>
  handOverCurrent(chain: ActiveChain, current: CurrentTask, session: HandoffSession, reason: Reason, extra?: string): Promise<void>
  handOver(project: string, task: string, session: HandoffSession, reason: HandoffReason, extra?: string): Promise<string>
}

type Halt = (chain: ActiveChain, error: Notice, keep?: boolean) => void

/** The port's machine makes the moves when it carries them (`MachinePort.moves`); otherwise the hub's process does. */
export function taskMoves(state: ChainState, deps: DispatcherDeps, halt: Halt): TaskMoves {
  const reportOf = (task: string): string | undefined => {
    const gates = Object.values(state.ci)
    return gates.find((gate) => gate.fix?.task === task)?.fix?.report ?? gates.find((gate) => gate.carry?.task === task)?.carry?.report
  }
  return deps.machine.moves === undefined ? localMoves(state, deps, halt, reportOf) : new HubMoves(state, deps, deps.machine.moves, halt, reportOf)
}

function localMoves(state: ChainState, deps: DispatcherDeps, halt: Halt, report: (task: string) => string | undefined): TaskMoves {
  const moveDeps: MoveDeps = { ...deps, save: () => deps.save(state), blocked: (project, task) => deps.blocked(project, task), report }
  const handovers = new Handovers(state, moveDeps, (chain, error) => halt(chain, error, error.code === 'chain.modelUnavailable'))
  const overage = new OverageStops(moveDeps, (chain, error) => halt(chain, error))
  return {
    guard: (chain) => overage.guard(chain),
    follow: (chain, current) => handovers.follow(chain, current),
    deliver: (chain, current, session, prompt, ask, move) => handovers.deliver(chain, current, session, prompt, ask, move),
    deliverLoose: (project, task, session, prompt) => handovers.deliverLoose(project, task, session, prompt),
    replace: (chain, current, replaced, session) => handovers.replace(chain, current, replaced, session),
    renew: (chain, current, session, prompt) => handovers.renew(chain, current, session, prompt),
    handOverCurrent: (chain, current, session, reason, extra) => handovers.handOverCurrent(chain, current, session, reason, extra),
    handOver: (_project, task, session, reason, extra) => handovers.handOver(task, session, reason, extra),
  }
}

const keyOf = (project: string, task: string): string => `${project}\u0000${task}`

/**
 * The hub's side of the moves over the link: each is a command `task.<move>` with the task's state and what the hub
 * decides about it; the machine's `task.state` events and the result carry the task's fields back into the chain.
 */
class HubMoves implements TaskMoves {
  /** The hub's task of each move under way, which the machine's mid-move state goes into. */
  private readonly moving = new Map<string, CurrentTask>()

  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly port: MovesPort,
    private readonly halt: Halt,
    private readonly report: (task: string) => string | undefined,
  ) {
    port.onSaved((saved) => this.saved(saved))
  }

  async guard(chain: ActiveChain): Promise<boolean> {
    const current = chain.current
    if (current === null || !guardDue(this.deps.machine, current)) return true
    try {
      return (await this.run('guard', chain.project, chain, current, [])) as boolean
    } catch (error) {
      this.halt(chain, noticeOf(error))
      return false
    }
  }

  async follow(chain: ActiveChain, current: CurrentTask): Promise<void> {
    if (!followDue(this.deps.machine, current)) return
    await this.chained(chain, () => this.run('follow', chain.project, chain, current, []))
  }

  async deliver(chain: ActiveChain, current: CurrentTask, session: HandoffSession, prompt: string, ask: string | null, move?: 'answer' | 'review'): Promise<boolean> {
    try {
      return (await this.run('deliver', chain.project, chain, current, [session, prompt, ask, move])) as boolean
    } catch (error) {
      return this.undelivered(current.task, session, error)
    }
  }

  async deliverLoose(project: string, task: string, session: HandoffSession, prompt: string): Promise<boolean> {
    try {
      return (await this.run('deliverLoose', project, undefined, undefined, [task, session, prompt], task)) as boolean
    } catch (error) {
      return this.undelivered(task, session, error)
    }
  }

  replace(chain: ActiveChain, current: CurrentTask, replaced: string, session: HandoffSession): Promise<void> {
    return this.chained(chain, () => this.run('replace', chain.project, chain, current, [replaced, session]))
  }

  renew(chain: ActiveChain, current: CurrentTask, session: HandoffSession, prompt: string): Promise<void> {
    return this.chained(chain, () => this.run('renew', chain.project, chain, current, [session, prompt]))
  }

  handOverCurrent(chain: ActiveChain, current: CurrentTask, session: HandoffSession, reason: Reason, extra?: string): Promise<void> {
    return this.chained(chain, () => this.run('handOverCurrent', chain.project, chain, current, [session, reason, extra]))
  }

  async handOver(project: string, task: string, session: HandoffSession, reason: HandoffReason, extra?: string): Promise<string> {
    return (await this.run('handOver', project, undefined, undefined, [task, session, reason, extra], task)) as string
  }

  /** A move of the chain's task the link failed: the chain pauses, as on a failed move on the machine. */
  private async chained(chain: ActiveChain, body: () => Promise<unknown>): Promise<void> {
    try {
      await body()
    } catch (error) {
      this.halt(chain, noticeOf(error))
    }
  }

  private undelivered(task: string, session: HandoffSession, error: unknown): false {
    this.deps.log(`chain: ${task}: the answer did not reach the session ${session.sessionId}: ${noticeOf(error).code}`)
    return false
  }

  private async run(name: MoveName, project: string, chain: ActiveChain | undefined, current: CurrentTask | undefined, args: unknown[], task = current?.task ?? ''): Promise<unknown> {
    const call: MoveCall = {
      project,
      ...(current === undefined ? {} : { current }),
      isCurrent: chain !== undefined && current !== undefined && chain.current === current,
      active: chain === undefined ? this.state.active.some((each) => each.project === project) : this.state.active.includes(chain),
      context: {
        blocked: this.deps.blocked(project, task) ?? null,
        language: this.deps.promptLanguage(task),
        mainBranch: this.deps.mainBranch(task),
        pullRequests: this.deps.pullRequests?.(task) ?? false,
        plain: this.deps.plain?.(task) ?? false,
        report: this.report(task) ?? null,
      },
      args,
    }
    const key = keyOf(project, task)
    if (current !== undefined) this.moving.set(key, current)
    try {
      const done = await this.port.run(name, call)
      if (current !== undefined && done.current !== undefined) this.apply(current, done.current)
      if (chain !== undefined && done.halt !== undefined) this.halt(chain, done.halt.notice, done.halt.keep)
      return done.value
    } finally {
      if (this.moving.get(key) === current) this.moving.delete(key)
    }
  }

  /**
   * The machine kept a move's state: into the task the move is under way for, else the chain's current one of the task.
   * A move it made without the hub (`alone`) is taken as the hub's own: its pause pauses the chain, and the next step
   * follows from the fields it left, so the move is not made again.
   */
  private saved({ project, task, fields, alone, halt }: MoveSaved): void {
    const chain = this.state.active.find((each) => each.project === project && each.current?.task === task)
    const target = this.moving.get(keyOf(project, task)) ?? chain?.current
    if (target == null) {
      this.deps.log(`chain: ${task}: the state a move kept is dropped, the task is no chain's current one`)
      return
    }
    if (alone) this.deps.log(`chain: ${task}: the machine moved its session while the hub was away; the hub takes the task's state it left`)
    this.apply(target, fields)
    if (halt !== undefined && chain !== undefined) this.halt(chain, halt.notice, halt.keep)
  }

  private apply(current: CurrentTask, fields: ReturnType<typeof fieldsOf>): void {
    // Small: a session id, a few times and the limit hold. `facts.js` is not imported here, the page's build reads this file.
    if (JSON.stringify(fieldsOf(current)) === JSON.stringify(fields)) return
    applyFields(current, fields)
    this.deps.save(this.state)
  }
}
