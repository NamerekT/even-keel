import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import type { Agent, AgentAdapter, SessionHandle, SessionStart } from '../agent/contract.js'
import { runGit } from '../git/run.js'
import type { AgentEntry } from '../sessions/agents.js'
import { TranscriptFold, type TranscriptSummary } from '../sessions/transcript.js'

/** What a turn of a scripted session sees: its task, its folder, the prompt it got and the main checkout to merge into. */
export interface TurnContext {
  task: string
  cwd: string
  prompt: string
  /** The project's main checkout. */
  repo: string
  /** Runs git in the session's folder; throws on a non-zero exit. */
  git(...args: string[]): Promise<string>
  /** Works on until the gate opens: the turn stays mid-turn and `settled` does not wait for it. */
  park(gate: Gate): Promise<void>
}

/** How a turn ends, as a session's transcript would show it. */
export type TurnEnd =
  | { say: string }
  | { checkpoint: string }
  | { noChanges: string }
  | { ask: string }
  | { limit: string }
  /** The process dies mid-turn. */
  | { crash: true }

export type Turn = (turn: TurnContext) => Promise<TurnEnd>

/** A launch or a resume of a task's session, with the prompt it went with. */
export interface Call {
  kind: 'launch' | 'resume' | 'stop'
  task: string
  sessionId: string
  cwd: string
  prompt: string
}

interface Session {
  entry: AgentEntry
  summary: TranscriptSummary
  /** Turns of this session still running: a stop lets theirs go unsaid. */
  turn: number
}

const PID = 4242
/** Captured before a scenario fakes the timers: `settled` polls in real time. */
const realTimeout = globalThis.setTimeout

/** What a parked turn waits for; the scenario opens it. */
export class Gate {
  readonly passed: Promise<void>
  open!: () => void

  constructor() {
    this.passed = new Promise((resolve) => (this.open = resolve))
  }
}

/**
 * A provider-neutral agent whose sessions play a script: each launch or resume of a task's session runs the task's
 * next turn. The turns do real git in the folder the chain gave; what the session ends with is put into its summary
 * the way an adapter's transcript reading would.
 */
export class ScriptedAgent implements Agent {
  readonly mode = 'script'
  readonly calls: Call[] = []
  private readonly scripts = new Map<string, Turn[]>()
  private readonly sessions_ = new Map<string, Session>()
  private readonly running = new Set<Promise<void>>()
  private parked = 0

  constructor(private readonly repo: () => string) {}

  /** The turns the task's sessions play, in order, across launches and resumes. */
  script(task: string, ...turns: Turn[]): void {
    this.scripts.set(task, [...(this.scripts.get(task) ?? []), ...turns])
  }

  /** The adapter to register in `AGENTS`. */
  adapter(): AgentAdapter {
    return { title: 'Script', checked: '1.0.0', setup: () => this }
  }

  /** Waits for every turn under way but the parked ones. */
  async settled(): Promise<void> {
    while (this.running.size > this.parked) await new Promise((resolve) => realTimeout(resolve, 5))
  }

  /** The sessions of a task, oldest first. */
  sessionsOf(task: string): AgentEntry[] {
    return [...this.sessions_.values()].filter((session) => session.entry.name === task).map((session) => session.entry)
  }

  /** A session ended or stopped: its process left, so the service sees it finished. */
  isGone(sessionId: string): boolean {
    const entry = this.sessions_.get(sessionId)?.entry
    return entry === undefined || (entry.pid === undefined && entry.resting !== true)
  }

  env(): NodeJS.ProcessEnv {
    return {}
  }

  async launch(home: AccountHome, start: SessionStart): Promise<string> {
    const sessionId = randomUUID()
    const summary = new TranscriptFold().summary()
    const entry: AgentEntry = { id: sessionId, cwd: start.cwd, kind: 'script', startedAt: Date.now(), sessionId, name: start.name, account: home.key }
    this.sessions_.set(sessionId, { entry, summary: { ...summary, workdir: start.cwd }, turn: 0 })
    this.calls.push({ kind: 'launch', task: start.name, sessionId, cwd: start.cwd, prompt: start.prompt })
    this.play(sessionId, start.prompt)
    return sessionId
  }

  async resume(_home: AccountHome, session: SessionHandle, start: SessionStart): Promise<string> {
    const known = this.sessions_.get(session.sessionId)
    if (known === undefined) throw new Error(`script: no session ${session.sessionId}`)
    this.calls.push({ kind: 'resume', task: start.name, sessionId: session.sessionId, cwd: start.cwd, prompt: start.prompt })
    this.play(session.sessionId, start.prompt)
    return session.sessionId
  }

  async stop(_home: AccountHome, session: SessionHandle): Promise<void> {
    const known = this.sessions_.get(session.sessionId)
    if (known === undefined) return
    known.turn++
    this.calls.push({ kind: 'stop', task: known.entry.name ?? '', sessionId: session.sessionId, cwd: known.entry.cwd, prompt: '' })
    const { pid: _, resting: __, status: ___, ask: ____, ...rest } = known.entry
    known.entry = { ...rest, state: 'stopped' }
  }

  async sessions(home: AccountHome): Promise<AgentEntry[]> {
    return [...this.sessions_.values()].filter((session) => session.entry.account === home.key).map((session) => ({ ...session.entry }))
  }

  tail(_home: AccountHome, agent: AgentEntry) {
    const session = () => this.sessions_.get(agent.sessionId)
    return {
      path: undefined,
      follow: () => {},
      read: async () => {},
      summary: () => session()?.summary ?? new TranscriptFold().summary(),
    }
  }

  async record(): Promise<undefined> {
    return undefined
  }

  async feed(): Promise<undefined> {
    return undefined
  }

  async transcripts(home: AccountHome): Promise<string[]> {
    return (await this.sessions(home)).map((entry) => entry.sessionId)
  }

  async authStatus() {
    return { loggedIn: true, authMethod: 'claude.ai', email: 'john@example.com', orgName: null, subscriptionType: 'max' }
  }

  login(): never {
    throw new Error('script: no sign-in')
  }

  async logout(): Promise<void> {}

  private play(sessionId: string, prompt: string): void {
    const session = this.sessions_.get(sessionId)!
    const task = session.entry.name!
    const turn = this.scripts.get(task)?.shift()
    if (turn === undefined) throw new Error(`script: ${task} has no turn left`)
    const id = ++session.turn
    const at = () => new Date().toISOString()
    session.entry = { ...session.entry, pid: PID, status: 'busy', state: 'working', resting: false }
    delete session.entry.ask
    session.summary = { ...session.summary, apiError: null, checkpoint: null, noChanges: null, ask: null, asking: false, lastActivityAt: at() }
    const cwd = session.entry.cwd
    const context: TurnContext = {
      task,
      cwd,
      prompt,
      repo: this.repo(),
      git: async (...args) => {
        const result = await runGit(cwd, args)
        if (result.code !== 0) throw new Error(`script: git ${args.join(' ')} in ${cwd}: ${result.out}`)
        return result.out
      },
      park: async (gate) => {
        this.parked++
        try {
          await gate.passed
        } finally {
          this.parked--
        }
      },
    }
    const running = turn(context)
      .catch((error: unknown): TurnEnd => {
        console.error(`script: ${task}: ${error instanceof Error ? error.message : String(error)}`)
        return { crash: true }
      })
      .then((end) => {
        if (session.turn !== id) return
        this.end(session, end, at())
      })
      .finally(() => this.running.delete(running))
    this.running.add(running)
  }

  private end(session: Session, end: TurnEnd, at: string): void {
    const { pid: _, ...rest } = session.entry
    const resting: AgentEntry = { ...rest, resting: true, status: 'idle', state: 'done' }
    const said = (text: string) => ({ ...session.summary, lastMessage: text, lastReplyAt: at, lastActivityAt: at })
    if ('crash' in end) {
      const { resting: __, status: ___, ...gone } = rest
      session.entry = { ...gone, state: 'failed' }
    } else if ('ask' in end) {
      const ask = { id: `ask-${randomUUID()}`, questions: [{ question: end.ask, header: 'Question', multiSelect: false, options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }] }] }
      session.entry = { ...session.entry, status: 'waiting', state: 'blocked', ask }
      session.summary = { ...said(end.ask), ask, asking: true }
    } else if ('limit' in end) {
      session.entry = resting
      session.summary = { ...said(end.limit), apiError: { kind: 'limit', text: end.limit, at } }
    } else if ('checkpoint' in end) {
      session.entry = resting
      session.summary = { ...said(`CHECKPOINT: ${end.checkpoint}`), checkpoint: end.checkpoint }
    } else if ('noChanges' in end) {
      session.entry = resting
      session.summary = { ...said(`NO CHANGES: ${end.noChanges}`), noChanges: end.noChanges }
    } else {
      session.entry = resting
      session.summary = said(end.say)
    }
  }
}

/** A turn that writes a file, commits it on the task's branch and merges the branch into the main checkout. */
export function commitAndMerge(file = 'work.txt'): Turn {
  return async ({ task, cwd, repo, git }) => {
    await writeFile(join(cwd, file), `${task}\n`)
    await git('add', file)
    await git('commit', '-m', `[${task}] Work`)
    const branch = await git('rev-parse', '--abbrev-ref', 'HEAD')
    const merged = await runGit(repo, ['merge', '--no-edit', branch])
    if (merged.code !== 0) throw new Error(`script: merge of ${branch}: ${merged.out}`)
    return { say: `${task} merged` }
  }
}

/** A turn that works until `gate` opens, then goes on as `then`. */
export function parked(gate: Gate, then: Turn): Turn {
  return async (turn) => {
    await turn.park(gate)
    return then(turn)
  }
}

/** A turn that writes its handoff note into the task's folder and ends with `CHECKPOINT:` naming it. */
export function checkpoint(note: string, text: string): Turn {
  return async ({ cwd }) => {
    await mkdir(dirname(join(cwd, note)), { recursive: true })
    await writeFile(join(cwd, note), text)
    return { checkpoint: note }
  }
}

/** A turn that ends the way `end` says. */
export function ends(end: TurnEnd): Turn {
  return async () => end
}
