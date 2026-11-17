import type { NoteText } from '../chain/handoff-note.js'
import type { HandoffSnapshot } from '../chain/snapshots.js'
import { isOwnName } from '../chain/fix.js'
import type { HandoffSession } from '../chain/relay.js'
import { BRIEF_COMMAND, type HubBrief } from './brief.js'
import { LIMITS_PLAN_COMMAND, type LimitsPlan } from '../limits/polls.js'
import type { HubHandlers } from '../link/hub.js'
import { FAILED_EVENT, INTERRUPTED_EVENT, REFUSED_EVENT, type Command, type MachineEvent } from '../link/protocol.js'
import { asNotice, fail, NoticeError, type Notice } from '../notice/notice.js'
import type { AssignedTask } from '../tracker/source.js'
import type { HeldChanges } from './assignments.js'
import { applyPatch, mirrorReads, type MachineFacts } from './facts.js'
import { MOVE_PREFIX, MOVE_STATE_EVENT, type MoveDone, type MoveSaved } from './move-call.js'
import type { LaunchBrief, MachinePort } from './port.js'
import { pageReads, type PageReads } from './page.js'
import { isRecordEvent } from './records.js'
import { remoteServices, type MachineServices } from './services.js'
import { COMMAND_PREFIX, DONE_EVENT, FACTS_EVENT, HANDOFF_EVENT, LEFTOVER_EVENT, TRANSCRIPT_EVENT, type CommandDone, type FactsPosted, type FactsSnapshot, type PortCommand } from './runner.js'

export interface RemoteDeps {
  /** Keeps the command for the machine and gives its number. */
  send: (machine: string, command: Command) => Promise<number>
  /** The machine this port stands for. */
  machine: () => string
  projectOf: (task: string) => string | undefined
  /** The project of the launch that made the session; `undefined` — the journal has none. */
  projectOfSession: (sessionId: string) => string | undefined
  /** The session of the task's newest entry in the hub's launch journal. */
  lastSession: (project: string, task: string) => string | undefined
  /** `retained` avoids reading the tracker on every follow while a limit waits. */
  brief?: (project: string, task: string, retained?: boolean) => Promise<LaunchBrief>
  /** Reads the hub's branch protection before a command that can launch a session. */
  audit?: (project: string) => Promise<void>
  /** The task's newest handoff note (`lastHandoffNote`, BTN-1046): sent with a move that may hand the task over. */
  note?: (project: string, task: string) => Promise<NoteText | undefined>
  /** Keeps a handoff snapshot the machine sent; a throw leaves the event with the machine, which sends it again. */
  saveSnapshot: (snapshot: HandoffSnapshot) => Promise<void> | void
  record?: (event: MachineEvent) => Promise<void>
  changed?: () => void
  /** A session the chain asked to stop has stopped on the machine. */
  stopped?: (session: HandoffSession) => void
  /** What a cleanup the machine finished late left on a task (`LEFTOVER_EVENT`). */
  leftover?: (project: string, task: string, notice: Notice) => void
  /** A session's transcript changed on the machine (`TRANSCRIPT_EVENT`). */
  transcript?: (sessionId: string) => void
  /** The task went to the machine with a launch; its place there is cleaned up. */
  assigned?: (project: string, task: string) => void
  released?: (project: string, task: string) => void
  /**
   * Squares the hub's record of the machine's tasks with the first snapshot of a connection that has read the sessions
   * (`docs/machines.md`, "Tasks to machines"): `named` — every task the machine knows a session of, `live` — the ones
   * with a live session there.
   */
  held?: (named: ReadonlySet<string>, live: AssignedTask[]) => HeldChanges
  /**
   * With the machine in this process: has it post what changed and waits until the hub took it, so a step of the chain
   * reads the machine as it is now. Absent for a machine elsewhere, whose mirror is as fresh as its last event.
   */
  catchUp?: () => Promise<void>
  log: (line: string) => void
}

interface Waiter {
  type: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

type Outcome = { value: unknown } | { error: Error | ((type: string) => Error) }
type Place = { project?: string | undefined; folder?: string | undefined }

/**
 * The hub's side of the port (`docs/machines.md`, "The chain over the link"). A command or a query goes to the machine
 * as a numbered command and the call waits for the event that names its number; a snapshot member reads the mirror,
 * which the machine's snapshot replaces at every connection and its `facts` events keep up between them.
 */
export class RemoteMachine {
  private mirror: FactsSnapshot | undefined
  /** The connection's snapshot came and the machine's tasks are not squared with it yet (`held`). */
  private unsquared = false
  private readonly waiters = new Map<number, Waiter>()
  /** Results that came while a send had not yet learnt its number. */
  private readonly early = new Map<number, Outcome>()
  private sending = 0
  /** Where the state of a move's task the machine kept goes: the chain's moves (`MovesPort.onSaved`). */
  private takeSaved: ((saved: MoveSaved) => void) | undefined

  constructor(private readonly deps: RemoteDeps) {}

  /** The page's and the chat's reads of the machine's sessions and accounts. */
  readonly page: PageReads = pageReads(() => this.facts())

  facts(): MachineFacts | undefined {
    return this.mirror?.facts
  }

  port(): MachinePort {
    const { deps } = this
    const ofTask = (task: string, session: HandoffSession) => this.placed(deps.projectOf(task), session)
    const ofSession = (session: HandoffSession) => this.placed(deps.projectOfSession(session.sessionId), session)
    const call = <T>(name: PortCommand, place: Place, args: unknown[]) => this.call(name, place, args) as Promise<T>
    return {
      ...mirrorReads(() => this.facts(), deps.lastSession),
      launch: async (project, task, extra, brief) => {
        const prepared = brief ?? await deps.brief?.(project, task)
        const launched = await call<Awaited<ReturnType<MachinePort['launch']>>>('launch', { project }, [project, task, extra, prepared])
        deps.assigned?.(project, task)
        return launched
      },
      launchFix: (project, name, report, reran) => call('launchFix', { project }, [project, name, report, reran]),
      launchCarry: (project, name, report) => call('launchCarry', { project }, [project, name, report]),
      resume: (task, session) => call('resume', ofTask(task, session), [task, session]),
      reply: (task, session, prompt) => call('reply', ofTask(task, session), [task, session, prompt]),
      relay: async (task, session, prompt, reason, brief) => {
        const project = deps.projectOf(task)
        const prepared = brief ?? (project === undefined || isOwnName(task) ? undefined : await deps.brief?.(project, task))
        return call('relay', ofTask(task, session), [task, session, prompt, reason, prepared])
      },
      stop: async (session) => {
        await call('stop', ofSession(session), [session])
        deps.stopped?.(session)
      },
      locate: (session) => call('locate', ofSession(session), [session]),
      finish: async (project, task, pull) => {
        const outcome = await call<Awaited<ReturnType<MachinePort['finish']>>>('finish', { project }, [project, task, pull])
        deps.released?.(project, task)
        return outcome
      },
      sync: (project) => call('sync', { project }, [project]),
      prepare: (project, task) => call('prepare', { project }, [project, task]),
      checkMain: (project, task, commit) => call('checkMain', { project }, [project, task, commit]),
      runAfterGreen: (project, commit) => call('runAfterGreen', { project }, [project, commit]),
      head: (project) => call('head', { project }, [project]),
      tree: (project, commit) => call('tree', { project }, [project, commit]),
      merged: (project, task) => call('merged', { project }, [project, task]),
      carried: (project, commit) => call('carried', { project }, [project, commit]),
      changes: (project, workdir) => call('changes', { project, folder: workdir }, [project, workdir]),
      history: (project, commit, candidates) => call('history', { project }, [project, commit, candidates]),
      modelBlock: (project, task) => call('modelBlock', { project }, [project, task]),
      ...(deps.catchUp === undefined ? {} : { catchUp: deps.catchUp }),
      moves: {
        run: async (name, move) => {
          if (name !== 'guard') await deps.audit?.(move.project)
          const task = move.current?.task ?? move.args[0]
          const replyOnly = name === 'guard' || name === 'deliver' || name === 'deliverLoose'
          const brief = replyOnly || typeof task !== 'string' || isOwnName(task) ? undefined : await deps.brief?.(move.project, task, name === 'follow')
          const note = replyOnly || typeof task !== 'string' ? undefined : await deps.note?.(move.project, task)
          const context = { ...move.context, ...(brief === undefined ? {} : { brief }), ...(note === undefined ? {} : { note }) }
          return this.send(MOVE_PREFIX + name, { project: move.project }, { ...move, context }) as Promise<MoveDone>
        },
        onSaved: (take) => {
          this.takeSaved = take
        },
      },
    }
  }

  /**
   * The page's, the hooks' and the chat's commands to the machine (`MachineServices`). A command that writes into a
   * session's folder names it with its project, as the port's do: the machine checks it against what it agreed to.
   */
  services(): MachineServices {
    return remoteServices((group, name, args) => {
      let place: Place = {}
      if (group === 'chat' && name === 'steer') place = this.placed(this.deps.projectOf(args[0] as string), args[1] as HandoffSession)
      if (group === 'chat' && name === 'saveInbox') place = { project: args[0] as string, folder: args[1] as string }
      return this.ask(`${group}.${name}`, place, args)
    })
  }

  /** Tells the machine which account folders another machine polls and the newest limits of their accounts (BTN-991). */
  async tellLimits(plan: LimitsPlan): Promise<void> {
    await this.send(LIMITS_PLAN_COMMAND, {}, plan)
  }

  /** Hands the machine the hub's brief (`docs/machines.md`, "The brief"); it waits for the machine to take it. */
  async tellBrief(brief: HubBrief): Promise<void> {
    await this.send(BRIEF_COMMAND, {}, brief)
  }

  handlers(): HubHandlers {
    return {
      snapshot: (machine, snapshot) => {
        if (!this.mine(machine)) return
        this.mirror = snapshot as FactsSnapshot
        this.unsquared = true
        this.square()
        this.deps.changed?.()
      },
      event: (machine, event) => (this.mine(machine) ? this.event(event) : undefined),
    }
  }

  /** Once per connection: a machine that has not read its sessions yet names none, which would empty its rows. */
  private square(): void {
    const facts = this.mirror?.facts
    const { held, log } = this.deps
    if (!this.unsquared || held === undefined || facts?.sessionsRead !== true) return
    this.unsquared = false
    const live = Object.entries(facts.tasks).flatMap(([task, each]) => {
      if (each.live === undefined) return []
      const project = this.deps.projectOfSession(each.live) ?? this.deps.projectOf(task)
      return project === undefined ? [] : [{ project, task }]
    })
    const machine = this.deps.machine()
    const { removed, added, refused } = held(new Set(Object.keys(facts.tasks)), live)
    for (const { task } of removed) log(`machine: ${task} is no longer on machine ${machine}, its row in machine_tasks is removed`)
    for (const { task } of refused) log(`machine: ${task} has a live session on machine ${machine}, but was moved off it by hand: the chain goes on with it elsewhere and leaves that session alone`)
    for (const { task, from } of added) {
      log(from === undefined
        ? `machine: ${task} has a live session on machine ${machine} and no row in machine_tasks, it is added`
        : `machine: ${task} has a live session on machine ${machine} and was ${from}'s in machine_tasks, it is ${machine}'s now`)
    }
  }

  private mine(machine: string): boolean {
    if (machine === this.deps.machine()) return true
    this.deps.log(`machine: ${machine} is not a machine of this hub's chain, what it sent is dropped`)
    return false
  }

  /** The folder goes into the command only with its project: the machine checks it against what it agreed to. */
  private placed(project: string | undefined, session: HandoffSession): { project?: string; folder?: string } {
    if (project === undefined) return {}
    return typeof session.workdir === 'string' && session.workdir !== '' ? { project, folder: session.workdir } : { project }
  }

  private async call(name: PortCommand, place: Place, args: unknown[]): Promise<unknown> {
    if (place.project !== undefined && ['launch', 'launchFix', 'launchCarry', 'relay'].includes(name)) await this.deps.audit?.(place.project)
    return this.ask(COMMAND_PREFIX + name, place, args)
  }

  private ask(type: string, place: Place, args: unknown[]): Promise<unknown> {
    while (args.length > 0 && args.at(-1) === undefined) args = args.slice(0, -1)
    return this.send(type, place, { args })
  }

  private async send(type: string, place: Place, payload: unknown): Promise<unknown> {
    const command: Command = {
      type,
      ...(place.project === undefined ? {} : { project: place.project }),
      ...(place.folder === undefined ? {} : { folder: place.folder }),
      payload,
    }
    this.sending += 1
    let seq: number
    try {
      seq = await this.deps.send(this.deps.machine(), command)
    } finally {
      this.sending -= 1
    }
    const came = this.early.get(seq)
    if (this.sending === 0) this.early.clear()
    else this.early.delete(seq)
    if (came !== undefined) {
      if ('value' in came) return came.value
      throw typeof came.error === 'function' ? came.error(type) : came.error
    }
    return new Promise((resolve, reject) => this.waiters.set(seq, { type, resolve, reject }))
  }

  private async event(event: MachineEvent): Promise<void> {
    const payload = (event.payload ?? {}) as Record<string, unknown>
    if (event.type === FACTS_EVENT) {
      const { boot, rev, patch } = payload as unknown as FactsPosted
      // A post older than the snapshot of this connection, kept by the machine while it was away.
      if (this.mirror === undefined || boot !== this.mirror.boot || rev <= this.mirror.rev) return
      this.mirror = { boot, rev, facts: applyPatch(this.mirror.facts, patch) }
      this.square()
      this.deps.changed?.()
    } else if (event.type === DONE_EVENT) {
      const done = payload as unknown as CommandDone
      if (done.notice === undefined) this.settle(done.seq, event.type, { value: done.value })
      else this.settle(done.seq, event.type, { error: new NoticeError(asNotice(done.notice), done.cause === undefined ? undefined : { cause: new Error(done.cause) }) })
    } else if (event.type === FAILED_EVENT) {
      this.settle(Number(payload.seq), event.type, { error: (type) => fail('machine.commandFailed', { command: type, error: String(payload.error) }) })
    } else if (event.type === REFUSED_EVENT && payload.reason === 'taken') {
      this.settle(Number(payload.seq), event.type, { error: fail('machines.folderTaken', { name: String(payload.name || payload.machine), owner: String(payload.machine) }) })
    } else if (event.type === REFUSED_EVENT) {
      this.settle(Number(payload.seq), event.type, { error: (type) => fail('machine.commandRefused', { command: type, reason: payload.reason === 'folder' ? 'folder' : 'project' }) })
    } else if (event.type === INTERRUPTED_EVENT) {
      this.settle(Number(payload.seq), event.type, { error: (type) => fail('machine.commandInterrupted', { command: type }) })
    } else if (event.type === MOVE_STATE_EVENT) {
      if (this.takeSaved === undefined) this.deps.log('machine: the state of a move came before the chain, it is dropped')
      else this.takeSaved(payload as unknown as MoveSaved)
    } else if (event.type === HANDOFF_EVENT) {
      await this.deps.saveSnapshot(payload as unknown as HandoffSnapshot)
    } else if (event.type === LEFTOVER_EVENT) {
      const { project, task, notice } = payload as { project: string; task: string; notice: Notice }
      this.deps.leftover?.(project, task, asNotice(notice))
    } else if (event.type === TRANSCRIPT_EVENT) {
      this.deps.transcript?.(String(payload.sessionId))
    } else if (isRecordEvent(event.type)) {
      if (this.deps.record === undefined) throw new Error(`machine: no writer for ${event.type}`)
      await this.deps.record(event)
    } else {
      this.deps.log(`machine: an event ${event.type} this hub does not know is dropped`)
    }
  }

  private settle(seq: number, event: string, outcome: Outcome): void {
    const waiter = this.waiters.get(seq)
    if (waiter === undefined) {
      if (this.sending > 0) this.early.set(seq, outcome)
      // The hub restarted since it sent the command: a launch it began is found by the chain's own recovery.
      else this.deps.log(`machine: ${event} of command ${seq} came and nothing waits for it`)
      return
    }
    this.waiters.delete(seq)
    if ('value' in outcome) waiter.resolve(outcome.value)
    else waiter.reject(typeof outcome.error === 'function' ? outcome.error(waiter.type) : outcome.error)
  }
}
