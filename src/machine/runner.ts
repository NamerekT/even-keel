import type { AccountLedger } from '../account/ledger.js'
import type { AccountView } from '../account/model.js'
import type { RateLimits } from '../limits/model.js'
import type { UsageHealth } from '../limits/usage.js'
import type { NumberedCommand } from '../link/protocol.js'
import { noticeOf, type Notice } from '../notice/notice.js'
import { patchOf, resetKey, type FactsPatch, type MachineFacts, type ProjectFacts, type RunFacts, type TaskFacts } from './facts.js'
import { isMove, MOVE_PREFIX, type MoveCall, type MoveDone, type MoveName } from './move-call.js'
import type { MachinePort } from './port.js'
import type { SessionMail } from '../sessions/mail.js'
import type { SessionView } from '../state.js'

/** The port's commands and queries, as the link names them: `port.<member>` with `{ args }` as the payload. */
export const PORT_COMMANDS = [
  'launch', 'launchFix', 'launchCarry', 'resume', 'reply', 'relay', 'stop', 'locate',
  'finish', 'sync', 'prepare', 'checkMain', 'runAfterGreen', 'head', 'tree', 'merged', 'carried', 'changes', 'history', 'modelBlock',
] as const
export type PortCommand = (typeof PORT_COMMANDS)[number]
export const COMMAND_PREFIX = 'port.'

/** The machine's events of the chain: a command's result, the facts that changed, a handoff snapshot for the hub's database. */
export const DONE_EVENT = 'command.done'
export const FACTS_EVENT = 'facts'
export const HANDOFF_EVENT = 'handoff.snapshot'

/** What a command gave: its value, or the notice of what it threw with the message of the error under it. */
export interface CommandDone {
  seq: number
  value?: unknown
  notice?: Notice
  cause?: string
}

/** The snapshot of every connection: `boot` names the machine's process, `rev` grows with every post of facts. */
export interface FactsSnapshot {
  boot: string
  rev: number
  facts: MachineFacts
}

export interface FactsPosted {
  boot: string
  rev: number
  patch: FactsPatch
}

export interface RunnerDeps {
  /** The machine's own port: the sessions, the folders and the accounts of this host. */
  local: MachinePort
  emit: (type: string, payload: unknown) => Promise<unknown>
  boot: string
  projects: () => string[]
  /** The tasks that have a session on this machine, with their sessions' ids. */
  tasks: () => Array<{ task: string; sessions: string[] }>
  /** The tasks of the project that have a run of their own. */
  runs: (project: string) => string[]
  /** The tasks of the project whose check before the merge reported. */
  reported: (project: string) => string[]
  /** The model a new session of the project (or of `task`) would ask for. */
  model: (project: string, task?: string) => string | null
  accounts: () => string[]
  limitsOf: (account: string) => RateLimits | null
  ledger: () => AccountLedger['accounts']
  sessions?: () => SessionView[]
  mailbox?: () => Record<string, SessionMail>
  /** The accounts panel, `usage` by account folder, and by session the folder and the compactions (`MachineFacts`). */
  panel?: () => AccountView
  usageOf?: (account: string) => UsageHealth
  owners?: () => Record<string, string>
  compactions?: () => Record<string, number>
  /** Makes the moves of a task's session the hub asks for (`task.<move>`). */
  moves?: { run: (name: MoveName, call: MoveCall) => Promise<MoveDone> }
  /** Runs one computation of the facts, so its reads may share what they read (`AccountWatcher.batch`). */
  scope?: <T>(body: () => T) => T
  log: (line: string) => void
}

const isPortCommand = (name: string): name is PortCommand => (PORT_COMMANDS as readonly string[]).includes(name)

/**
 * The machine's side of the port (`docs/machines.md`, "The chain over the link"): runs the hub's commands on the local
 * port and tells the hub what they gave and what the machine holds. The facts go before a command's result, so the
 * hub's mirror is never older than a result it acts on.
 */
export class MachineRunner {
  private rev = 0
  private posted: MachineFacts | undefined
  private publishing: Promise<void> = Promise.resolve()
  /** The post queued behind `publishing` whose read has not begun yet. */
  private waiting: Promise<void> | undefined

  constructor(private readonly deps: RunnerDeps) {}

  /** What the machine holds now, for the first post of a connection; later posts carry only what changed since. */
  snapshot(): FactsSnapshot {
    const facts = this.facts()
    this.posted = facts
    this.rev += 1
    return { boot: this.deps.boot, rev: this.rev, facts }
  }

  /**
   * Posts the facts that changed since the last post; nothing before the first snapshot, which carries them all. Posts
   * asked while one waits for its turn share it: its read has not begun, so it is as fresh as a read of each of them.
   */
  publish(): Promise<void> {
    if (this.waiting !== undefined) return this.waiting
    const run = this.publishing.then(async () => {
      this.waiting = undefined
      if (this.posted === undefined) return
      const facts = this.facts()
      const patch = patchOf(this.posted, facts)
      if (patch === undefined) return
      this.posted = facts
      this.rev += 1
      await this.deps.emit(FACTS_EVENT, { boot: this.deps.boot, rev: this.rev, patch } satisfies FactsPosted)
    })
    this.publishing = run.catch(() => {})
    this.waiting = run
    return run
  }

  /** Runs one command of the hub. An unknown one throws, which the link reports as `command.failed`. */
  async command(command: NumberedCommand): Promise<void> {
    const run = this.handler(command)
    let done: CommandDone
    try {
      const value = await run()
      done = { seq: command.seq, ...(value === undefined ? {} : { value }) }
    } catch (error) {
      const under = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined
      done = { seq: command.seq, notice: noticeOf(error), ...(under === undefined ? {} : { cause: under }) }
    }
    await this.publish().catch((error: unknown) => this.deps.log(`machine: the facts after command ${command.seq} were not posted: ${error instanceof Error ? error.message : String(error)}`))
    await this.deps.emit(DONE_EVENT, done)
  }

  /** A port member or a move of a task's session; what the machine does not know or serve throws. */
  private handler(command: NumberedCommand): () => Promise<unknown> {
    if (command.type.startsWith(MOVE_PREFIX)) {
      const name = command.type.slice(MOVE_PREFIX.length)
      const { moves } = this.deps
      if (!isMove(name)) throw new Error(`the machine knows no command ${command.type}`)
      if (moves === undefined) throw new Error(`the machine does not serve ${command.type}`)
      return () => moves.run(name, command.payload as MoveCall)
    }
    const name = command.type.startsWith(COMMAND_PREFIX) ? command.type.slice(COMMAND_PREFIX.length) : ''
    if (!isPortCommand(name)) throw new Error(`the machine knows no command ${command.type}`)
    const member = this.deps.local[name] as ((...args: unknown[]) => Promise<unknown>) | undefined
    if (member === undefined) throw new Error(`the machine does not serve ${command.type}`)
    const raw = (command.payload as { args?: unknown } | undefined)?.args
    // JSON carries a left-out argument as `null`.
    const args = (Array.isArray(raw) ? raw : []).map((arg: unknown) => (arg === null ? undefined : arg))
    return () => member(...args)
  }

  private facts(): MachineFacts {
    return this.deps.scope === undefined ? this.read() : this.deps.scope(() => this.read())
  }

  private read(): MachineFacts {
    const { local } = this.deps
    const tasks: Record<string, TaskFacts> = {}
    const resets: Record<string, string | null> = {}
    const accounts = new Set(this.deps.accounts())
    const reset = (session: { account: string; limit: { at: string; text: string } }) => {
      accounts.add(session.account)
      const key = resetKey(session.account, session.limit.at, session.limit.text)
      if (!Object.hasOwn(resets, key)) resets[key] = local.limitResetAfter(session.account, session.limit.at, session.limit.text)
    }
    for (const { task, sessions } of this.deps.tasks()) {
      const live = local.liveSession(task)
      const asked = local.asked(task)
      const silentSince = local.silentSince?.(task) ?? null
      const limited = local.limited(task)
      const overage = local.overage?.(task)
      const handoff = local.handoff(task)
      const refusals = Object.fromEntries(sessions.flatMap((sessionId) => {
        const refusal = local.modelRefusal?.(task, sessionId)
        return refusal === undefined ? [] : [[sessionId, refusal] as const]
      }))
      // A transient refusal is retried in its session: asking about it would count it into the account's retry ladder.
      if (limited !== undefined && limited.transient !== true) reset(limited)
      if (overage !== undefined) reset(overage.session)
      const facts: TaskFacts = {
        ...(live !== undefined && { live }),
        ...(local.busy(task) && { busy: true as const }),
        ...(local.midTurn(task) && { midTurn: true as const }),
        ...(local.shell(task) && { shell: true as const }),
        ...(asked !== null && { asked }),
        ...(silentSince !== null && { silentSince }),
        ...(limited !== undefined && { limited }),
        ...(overage !== undefined && { overage }),
        ...(handoff !== undefined && { handoff }),
        ...(Object.keys(refusals).length > 0 && { refusals }),
      }
      if (Object.keys(facts).length > 0) tasks[task] = facts
    }
    const projects: Record<string, ProjectFacts> = {}
    for (const project of this.deps.projects()) {
      const pause = local.packagesPause(project)
      const missing = local.trackerMissing(project)
      projects[project] = {
        ...(local.packagesBlocked(project) && { packagesBlocked: true as const }),
        ...(pause !== undefined && { packagesPause: pause }),
        ...(missing !== undefined && { trackerMissing: missing }),
        run: this.run(project),
        tasks: Object.fromEntries(this.deps.runs(project).map((task) => [task, this.run(project, task)])),
        reported: Object.fromEntries(this.deps.reported(project).flatMap((task) => {
          const tree = local.reportedTree(project, task)
          return tree === null ? [] : [[task, tree] as const]
        })),
      }
    }
    const { usageOf } = this.deps
    return {
      ...(this.deps.sessions === undefined ? {} : { sessions: Object.fromEntries(this.deps.sessions().map((view) => [view.sessionId, view])) }),
      ...(this.deps.mailbox === undefined ? {} : { mailbox: this.deps.mailbox() }),
      ...(this.deps.panel === undefined ? {} : { panel: this.deps.panel() }),
      ...(usageOf === undefined ? {} : { usage: Object.fromEntries([...accounts].map((account) => [account, usageOf(account)])) }),
      ...(this.deps.owners === undefined ? {} : { owners: this.deps.owners() }),
      ...(this.deps.compactions === undefined ? {} : { compactions: this.deps.compactions() }),
      sessionsRead: local.sessionsRead(),
      accountsRead: local.accountsRead(),
      tasks,
      projects,
      ledger: this.deps.ledger(),
      limits: Object.fromEntries([...accounts].map((account) => [account, this.deps.limitsOf(account)])),
      resets,
    }
  }

  private run(project: string, task?: string): RunFacts {
    const { local } = this.deps
    // The port asks `launchBlock` by task; a project's own answer is the one of any task without a run.
    const block = local.launchBlock(project, task ?? '')
    const unread = local.limitsUnread(project, task)
    return {
      account: local.account(project, task),
      model: this.deps.model(project, task),
      ...(block !== undefined && { launchBlock: block }),
      limitReset: local.limitReset(project, task),
      modelWeek: local.modelWeek?.(project, task) ?? null,
      ...(unread !== undefined && { limitsUnread: unread }),
    }
  }
}
