import type { ActiveChain, CurrentTask, DispatcherDeps, ReturnReason } from '../chain/model.js'
import type { HandoffReason, HandoffSession } from '../chain/relay.js'
import { sameJson } from './facts.js'
import { handoverMemory, Handovers, type HandoverMemory } from './handover.js'
import type { MoveDeps } from './host.js'
import { applyFields, fieldsOf, followDue, guardDue, MOVE_STATE_EVENT, type MoveCall, type MoveDone, type MoveFields, type MoveName, type MoveSaved } from './move-call.js'
import { OverageStops } from './overage.js'
import type { MachinePort } from './port.js'

export * from './move-call.js'

/** How often a machine without its hub looks at the tasks the hub gave it (BTN-1226). */
export const ALONE_TICK_MS = 15_000

/**
 * The hub's last word on a task of its chain (BTN-1226): its last move call, the task in it as the machine's moves left
 * it, and `base` — the move fields the hub is known to hold.
 */
export interface HeldMove {
  call: MoveCall & { current: CurrentTask }
  base: MoveFields
  /** A move made without the hub paused the chain: nothing more is made until the hub's next call. */
  halted?: true
}

/** What lets a machine move without its hub: absent — it waits for the hub's commands (the hub's own machine). */
export interface MovesAlone {
  online: () => boolean
  /** The hub's newest brief still has the task as its project's current one, of a chain not paused. */
  permits: (project: string, task: string) => boolean
  /** Where the held moves outlive the machine's process. */
  keep?: { load: () => Promise<HeldMove[]>; save: (held: HeldMove[]) => void }
}

export interface MachineMovesDeps {
  local: MachinePort
  emit: (type: string, payload: unknown) => Promise<unknown>
  journal: DispatcherDeps['journal']
  now: () => Date
  log: (line: string) => void
  alone?: MovesAlone
}

const keyOf = (project: string, task: string): string => `${project}\u0000${task}`
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The machine's side of the moves: each command runs `Handovers` or `OverageStops` with the machine's own port over the
 * task the hub sent. The memory of the moves (the retry ladder, the sources of a handoff) is the machine's, shared by all.
 * With `alone` it keeps the hub's last call of each task and, while the link is down, follows and guards the task by
 * its own facts (`docs/machines/seam.md`, "Moves").
 */
export class MachineMoves {
  private readonly memory: HandoverMemory = handoverMemory()
  private readonly held = new Map<string, HeldMove>()
  private readonly locks = new Map<string, Promise<unknown>>()
  private timer: ReturnType<typeof setInterval> | undefined
  private ticking = false

  constructor(private readonly deps: MachineMovesDeps) {}

  /** Reads the held moves back and starts the clock of the moves without the hub. */
  async start(everyMs = ALONE_TICK_MS): Promise<void> {
    const { alone } = this.deps
    if (alone === undefined) return
    for (const each of (await alone.keep?.load()) ?? []) this.held.set(keyOf(each.call.project, each.call.current.task), each)
    this.timer ??= setInterval(() => void this.tick(), everyMs)
    this.timer.unref?.()
  }

  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }

  /** A move the hub asked for. */
  async run(name: MoveName, call: MoveCall): Promise<MoveDone> {
    const { alone } = this.deps
    const current = call.current
    if (alone === undefined || current === undefined) return this.make(name, call)
    const key = keyOf(call.project, current.task)
    return this.locked(key, async () => {
      const held = this.held.get(key)
      const sent = fieldsOf(current)
      const own = held === undefined ? undefined : fieldsOf(held.call.current)
      // The hub has not taken yet what the machine did without it: its call holds the state before, so it goes on from the machine's.
      if (held !== undefined && own !== undefined && !sameJson(sent, own) && sameJson(sent, held.base)) {
        this.deps.log(`machine: ${current.task}: the hub's ${name} holds the task as before the moves made without it; it goes on from the machine's state`)
        applyFields(current, own)
      }
      const done = await this.make(name, call)
      // A copy: the moves without the hub change the task's limit hold in place, and `base` stays what the hub holds.
      if (call.isCurrent && call.active) this.held.set(key, { call: { ...call, current: structuredClone(current), args: [] }, base: structuredClone(fieldsOf(current)), ...(done.halt === undefined ? {} : { halted: true as const }) })
      else this.held.delete(key)
      for (const [other, each] of this.held) if (!alone.permits(each.call.project, each.call.current.task)) this.held.delete(other)
      this.persist()
      return done
    })
  }

  /** One look of the machine without its hub at the tasks the hub gave it; nothing while the link is up. */
  async tick(): Promise<void> {
    const { alone } = this.deps
    if (alone === undefined || this.ticking || alone.online()) return
    this.ticking = true
    try {
      for (const [key, held] of [...this.held]) {
        if (held.halted || !alone.permits(held.call.project, held.call.current.task)) continue
        await this.locked(key, () => (alone.online() || this.held.get(key) !== held ? Promise.resolve() : this.alone(held)))
      }
    } finally {
      this.ticking = false
    }
  }

  /** The guard and the follow of a step, as the hub's chain makes them, over the hub's last word on the task. */
  private async alone(held: HeldMove): Promise<void> {
    const { local, log } = this.deps
    const { call } = held
    const current = call.current
    const before = fieldsOf(current)
    let halt: MoveDone['halt']
    try {
      if (guardDue(local, current)) halt = (await this.make('guard', call)).halt
      if (halt === undefined && followDue(local, current)) halt = (await this.make('follow', call)).halt
    } catch (error) {
      log(`machine: ${current.task}: a move without the hub failed: ${messageOf(error)}`)
    }
    if (halt === undefined && sameJson(before, fieldsOf(current))) return
    if (halt !== undefined) held.halted = true
    log(`machine: ${current.task}: moved its session without the hub${halt === undefined ? '' : `, the chain is to pause on ${halt.notice.code}`}`)
    const saved: MoveSaved = { project: call.project, task: current.task, fields: fieldsOf(current), alone: true, ...(halt === undefined ? {} : { halt }) }
    await this.deps.emit(MOVE_STATE_EVENT, saved).catch((error: unknown) => log(`machine: the state of ${current.task} after a move without the hub was not kept: ${messageOf(error)}`))
    this.persist()
  }

  private persist(): void {
    this.deps.alone?.keep?.save([...this.held.values()])
  }

  /** One move of a task at a time: the hub's and the machine's own never cross. */
  private locked<T>(key: string, body: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(key) ?? Promise.resolve()).then(body, body)
    const settled = run.catch(() => {})
    this.locks.set(key, settled)
    void settled.then(() => {
      if (this.locks.get(key) === settled) this.locks.delete(key)
    })
    return run
  }

  private async make(name: MoveName, call: MoveCall): Promise<MoveDone> {
    const { project, current, context } = call
    const chain: ActiveChain = { project, current: call.isCurrent && current !== undefined ? current : null, paused: false, error: null }
    let halt: MoveDone['halt']
    let saving: Promise<unknown> = Promise.resolve()
    const save = (): void => {
      if (current === undefined) return
      const saved: MoveSaved = { project, task: current.task, fields: fieldsOf(current) }
      saving = saving.then(() => this.deps.emit(MOVE_STATE_EVENT, saved)).catch((error: unknown) => {
        this.deps.log(`machine: the state of ${current.task} mid-move was not kept: ${messageOf(error)}`)
      })
    }
    const deps: MoveDeps = {
      machine: context.brief === undefined ? this.deps.local : {
        ...this.deps.local,
        relay: (task, session, prompt, reason) => this.deps.local.relay(task, session, prompt, reason, context.brief),
      },
      journal: this.deps.journal,
      now: this.deps.now,
      log: this.deps.log,
      save,
      blocked: () => context.blocked ?? undefined,
      report: () => context.report ?? undefined,
      promptLanguage: () => context.language,
      mainBranch: () => context.mainBranch,
      pullRequests: () => context.pullRequests,
      plain: () => context.plain,
      note: () => context.note,
    }
    const state = { active: call.active ? [chain] : [] }
    const handovers = new Handovers(state, deps, (_, notice) => (halt = { notice, keep: notice.code === 'chain.modelUnavailable' }), this.memory)
    const task = (): CurrentTask => {
      if (current === undefined) throw new Error(`the move ${name} needs its task`)
      return current
    }
    // JSON carries a left-out argument as `null`; only `ask` means something by it.
    const args: unknown = call.args.map((arg) => arg ?? undefined)
    let value: unknown
    switch (name) {
      case 'follow':
        await handovers.follow(chain, task())
        break
      case 'guard':
        value = await new OverageStops(deps, (_, notice) => (halt = { notice, keep: false })).guard(chain)
        break
      case 'deliver': {
        const [session, prompt, ask, move, user] = args as [HandoffSession, string, string | undefined, 'answer' | 'review' | undefined, boolean | undefined]
        value = await handovers.deliver(chain, task(), session, prompt, ask ?? null, move, user === true)
        break
      }
      case 'deliverLoose': {
        const [loose, session, prompt, user] = args as [string, HandoffSession, string, boolean | undefined]
        value = await handovers.deliverLoose(project, loose, session, prompt, user === true)
        break
      }
      case 'replace': {
        const [replaced, session] = args as [string, HandoffSession]
        await handovers.replace(chain, task(), replaced, session)
        break
      }
      case 'renew': {
        const [session, prompt] = args as [HandoffSession, string]
        await handovers.renew(chain, task(), session, prompt)
        break
      }
      case 'handOverCurrent': {
        const [session, reason, extra] = args as [HandoffSession, 'restart' | 'message' | 'checkpoint' | 'review' | ReturnReason, string | undefined]
        await handovers.handOverCurrent(chain, task(), session, reason, extra)
        break
      }
      case 'handOver': {
        const [own, session, reason, extra] = args as [string, HandoffSession, HandoffReason, string | undefined]
        value = await handovers.handOver(own, session, reason, extra)
        break
      }
    }
    await saving
    return {
      ...(value === undefined ? {} : { value }),
      ...(current === undefined ? {} : { current: fieldsOf(current) }),
      ...(halt === undefined ? {} : { halt }),
    }
  }
}
