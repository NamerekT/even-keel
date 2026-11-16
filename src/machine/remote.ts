import type { HandoffSnapshot } from '../chain/snapshots.js'
import type { HandoffSession } from '../chain/relay.js'
import type { HubHandlers } from '../link/hub.js'
import { FAILED_EVENT, INTERRUPTED_EVENT, REFUSED_EVENT, type Command, type MachineEvent } from '../link/protocol.js'
import { asNotice, fail, NoticeError } from '../notice/notice.js'
import { applyPatch, mirrorReads, type MachineFacts } from './facts.js'
import { MOVE_PREFIX, MOVE_STATE_EVENT, type MoveDone, type MoveSaved } from './move-call.js'
import type { MachinePort } from './port.js'
import { pageReads, type PageReads } from './page.js'
import { isRecordEvent } from './records.js'
import { COMMAND_PREFIX, DONE_EVENT, FACTS_EVENT, HANDOFF_EVENT, type CommandDone, type FactsPosted, type FactsSnapshot, type PortCommand } from './runner.js'

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
  /** Keeps a handoff snapshot the machine sent; a throw leaves the event with the machine, which sends it again. */
  saveSnapshot: (snapshot: HandoffSnapshot) => Promise<void> | void
  record?: (event: MachineEvent) => Promise<void>
  changed?: () => void
  /** The task went to the machine with a launch; its place there is cleaned up. */
  assigned?: (project: string, task: string) => void
  released?: (project: string, task: string) => void
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
      launch: async (project, task, extra) => {
        const launched = await call<Awaited<ReturnType<MachinePort['launch']>>>('launch', { project }, [project, task, extra])
        deps.assigned?.(project, task)
        return launched
      },
      launchFix: (project, name, report, reran) => call('launchFix', { project }, [project, name, report, reran]),
      launchCarry: (project, name, report) => call('launchCarry', { project }, [project, name, report]),
      resume: (task, session) => call('resume', ofTask(task, session), [task, session]),
      reply: (task, session, prompt) => call('reply', ofTask(task, session), [task, session, prompt]),
      relay: (task, session, prompt, reason) => call('relay', ofTask(task, session), [task, session, prompt, reason]),
      stop: (session) => call('stop', ofSession(session), [session]),
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
        run: (name, move) => this.send(MOVE_PREFIX + name, { project: move.project }, move) as Promise<MoveDone>,
        onSaved: (take) => {
          this.takeSaved = take
        },
      },
    }
  }

  handlers(): HubHandlers {
    return {
      snapshot: (machine, snapshot) => {
        if (!this.mine(machine)) return
        this.mirror = snapshot as FactsSnapshot
        this.deps.changed?.()
      },
      event: (machine, event) => (this.mine(machine) ? this.event(event) : undefined),
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

  private call(name: PortCommand, place: Place, args: unknown[]): Promise<unknown> {
    while (args.length > 0 && args.at(-1) === undefined) args = args.slice(0, -1)
    return this.send(COMMAND_PREFIX + name, place, { args })
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
      this.deps.changed?.()
    } else if (event.type === DONE_EVENT) {
      const done = payload as unknown as CommandDone
      if (done.notice === undefined) this.settle(done.seq, event.type, { value: done.value })
      else this.settle(done.seq, event.type, { error: new NoticeError(asNotice(done.notice), done.cause === undefined ? undefined : { cause: new Error(done.cause) }) })
    } else if (event.type === FAILED_EVENT) {
      this.settle(Number(payload.seq), event.type, { error: (type) => fail('machine.commandFailed', { command: type, error: String(payload.error) }) })
    } else if (event.type === REFUSED_EVENT) {
      this.settle(Number(payload.seq), event.type, { error: (type) => fail('machine.commandRefused', { command: type, reason: payload.reason === 'folder' ? 'folder' : 'project' }) })
    } else if (event.type === INTERRUPTED_EVENT) {
      this.settle(Number(payload.seq), event.type, { error: (type) => fail('machine.commandInterrupted', { command: type }) })
    } else if (event.type === MOVE_STATE_EVENT) {
      if (this.takeSaved === undefined) this.deps.log('machine: the state of a move came before the chain, it is dropped')
      else this.takeSaved(payload as unknown as MoveSaved)
    } else if (event.type === HANDOFF_EVENT) {
      await this.deps.saveSnapshot(payload as unknown as HandoffSnapshot)
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
