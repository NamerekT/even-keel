import { randomUUID } from 'node:crypto'
import type { AccountHome } from '../account/homes.js'
import type { AccountStatus } from '../account/model.js'
import { runGit } from '../git/run.js'
import type { SessionLimits } from '../limits/model.js'
import type { AgentEntry } from '../sessions/agents.js'
import type { MailEvent } from '../sessions/mail.js'
import { hungEntry } from '../sessions/silence.js'
import { type FeedLine, type Stage, TranscriptFold, type TranscriptSummary } from '../sessions/transcript.js'
import type { Agent, AgentAdapter, AgentOptions, SessionHandle, SessionMcp, SessionStart } from './contract.js'

/** What a turn of a scripted session sees: its task, its folder, the prompt it got and the main checkout to merge into. */
export interface TurnContext {
  task: string
  sessionId: string
  cwd: string
  prompt: string
  /** The project's main checkout. */
  repo: string
  /** Runs git in the session's folder; throws on a non-zero exit. */
  git(...args: string[]): Promise<string>
  /** Works on until the gate opens: the turn stays mid-turn and `settled` does not wait for it. */
  park(gate: Gate): Promise<void>
  /** Waits `ms` on the service's clock, mid-turn, the way `park` does. */
  pause(ms: number): Promise<void>
  /** Shows a step of the turn, as a transcript line would: the action, the stage and how full the context is. */
  show(step: TurnStep): void
  /** Asks the service for the chat's mail on `event`, as the `checkpoint` plugin's mailbox hook does; `null` — none. */
  mail(event: MailEvent): Promise<string | null>
  /** Starts a background command that outlives the turn: the turn ends in `shell`, its process alive until a stop. */
  background(): void
  /** Reports the account's windows mid-turn, as a Claude SDK session's `rate_limit_event` does (`AgentOptions.onLimits`). */
  limits(reported: SessionLimits): void
  /** Calls a tool of the session's gateway server `server`, as the CLI does over HTTP; the text of its answer, thrown when an error. */
  tool(server: string, name: string, args: Record<string, unknown>): Promise<string>
}

/** One step a turn shows: a tool call (`tool` names it) or the model's text, and where the work is. */
export interface TurnStep {
  text: string
  tool?: string
  stage?: Stage
  /** The context's tokens after the step. */
  context?: number
}

/** How a turn ends, as a session's transcript would show it. */
export type TurnEnd =
  | { say: string }
  | { checkpoint: string }
  | { noChanges: string }
  /** PR mode's mark: the path of the pull request's note in the session's folder. */
  | { pullRequest: string }
  /** A question with its options; none — Yes and No. */
  | { ask: string; options?: string[] }
  | { limit: string }
  /** The API refuses for spent credit (`billing_error`): an account signed in by a key waits for money, not for a reset. */
  | { credit: string }
  /** The API refuses before the model's first answer (a bad key): only the error reaches the transcript. */
  | { fail: string }
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
  /** The account's agent and the model the service asked for; `null` — the agent's configured default. */
  provider: string
  /** The account folder it ran on. */
  account: string
  model: string | null
}

/** A session as the script keeps it: what its listing and transcript show. */
export interface ScriptedSession {
  entry: AgentEntry
  summary: TranscriptSummary
  /** Every line of its transcript; the summary's feed is the last of them. */
  lines: FeedLine[]
  /** How many turns it has begun. */
  plays: number
  /** The prompt of its last turn. */
  prompt: string
  /** Turns of this session still running: a stop lets theirs go unsaid. */
  turn: number
  /** When the running turn last wrote to its transcript: its start. */
  wroteAt: number
  /** The gateway's servers of its last start. */
  mcp: SessionMcp[]
}

export const SCRIPT_PID = 4242
const FEED_SIZE = 30
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
 * the way an adapter's transcript reading would. The e2e tests drive it (`src/e2e/agent.fixture.ts`) and the demo plays
 * its scenario on it (`src/demo/agent.ts`).
 */
export class ScriptedAgent implements Agent {
  readonly mode = 'script'
  readonly calls: Call[] = []
  protected readonly known = new Map<string, ScriptedSession>()
  private readonly scripts = new Map<string, Turn[]>()
  private readonly running = new Set<Promise<void>>()
  private parked = 0
  private onLimits: AgentOptions['onLimits']

  constructor(
    /** The project checkout of a session's folder. */
    private readonly repo: (cwd: string) => string,
    /** The service's address, for the chat's mail; none — a turn asks for no mail. */
    private readonly address?: () => { host: string; port: number },
    private readonly title = 'Script',
  ) {}

  /** The turns the task's sessions play, in order, across launches and resumes. */
  script(task: string, ...turns: Turn[]): void {
    this.scripts.set(task, [...(this.scripts.get(task) ?? []), ...turns])
  }

  /** The adapter to register in `AGENTS`. */
  adapter(): AgentAdapter {
    return {
      title: this.title,
      checked: '1.0.0',
      latest: async () => '1.0.0',
      setup: (options) => {
        this.setUp(options)
        return this
      },
    }
  }

  protected setUp(options: AgentOptions): void {
    this.onLimits = options.onLimits
  }

  /** Waits for every turn under way but the parked ones. */
  async settled(): Promise<void> {
    while (this.running.size > this.parked) await new Promise((resolve) => realTimeout(resolve, 5))
  }

  /** The sessions of a task, oldest first. */
  sessionsOf(task: string): AgentEntry[] {
    return [...this.known.values()].filter((session) => session.entry.name === task).map((session) => session.entry)
  }

  env(): NodeJS.ProcessEnv {
    return {}
  }

  async launch(home: AccountHome, start: SessionStart): Promise<string> {
    const sessionId = randomUUID()
    const summary = new TranscriptFold().summary()
    const entry: AgentEntry = { id: sessionId, cwd: start.cwd, kind: 'script', startedAt: Date.now(), sessionId, name: start.name, account: home.key }
    this.known.set(sessionId, { entry, summary: { ...summary, workdir: start.cwd }, lines: [], plays: 0, prompt: start.prompt, turn: 0, wroteAt: Date.now(), mcp: start.mcp ?? [] })
    this.calls.push({ kind: 'launch', task: start.name, sessionId, cwd: start.cwd, prompt: start.prompt, provider: home.agent, account: home.key, model: start.model })
    this.play(sessionId, start.prompt)
    return sessionId
  }

  async resume(home: AccountHome, session: SessionHandle, start: SessionStart): Promise<string> {
    const known = this.known.get(session.sessionId)
    if (known === undefined) throw new Error(`script: no session ${session.sessionId}`)
    known.mcp = start.mcp ?? []
    this.calls.push({ kind: 'resume', task: start.name, sessionId: session.sessionId, cwd: start.cwd, prompt: start.prompt, provider: home.agent, account: home.key, model: start.model })
    this.play(session.sessionId, start.prompt)
    return session.sessionId
  }

  async stop(home: AccountHome, session: SessionHandle): Promise<void> {
    const known = this.known.get(session.sessionId)
    if (known === undefined) return
    known.turn++
    this.calls.push({ kind: 'stop', task: known.entry.name ?? '', sessionId: session.sessionId, cwd: known.entry.cwd, prompt: '', provider: home.agent, account: home.key, model: null })
    const { pid: _, resting: __, status: ___, ask: ____, ...rest } = known.entry
    known.entry = { ...rest, state: 'stopped' }
    this.changed()
  }

  async sessions(home: AccountHome): Promise<AgentEntry[]> {
    return this.listed(home)
  }

  protected listed(home: AccountHome): AgentEntry[] {
    // A busy turn carries the time of its last write, as the adapters' transcript reading gives it (`TurnActivity`).
    return [...this.known.values()].filter((session) => session.entry.account === home.key).map((session) => hungEntry({ ...session.entry }, session.wroteAt, Date.now()))
  }

  tail(_home: AccountHome, agent: AgentEntry) {
    const session = () => this.known.get(agent.sessionId)
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

  async feed(_home: AccountHome, _sessionId: string, _after: number): Promise<{ lines: FeedLine[]; turn: TranscriptSummary['turn'] } | undefined> {
    return undefined
  }

  async transcripts(home: AccountHome): Promise<string[]> {
    return this.listed(home).map((entry) => entry.sessionId)
  }

  async authStatus(home: AccountHome): Promise<AccountStatus> {
    return { loggedIn: true, authMethod: 'claude.ai', email: `${home.key}@example.com`, orgName: null, subscriptionType: 'max' }
  }

  login(): never {
    throw new Error('script: no sign-in')
  }

  async logout(): Promise<void> {}

  /** The turn the session plays next; `undefined` — the script has none left. */
  protected nextTurn(session: ScriptedSession): Turn | undefined {
    return this.scripts.get(session.entry.name!)?.shift()
  }

  /** A session's listing or transcript changed. */
  protected changed(): void {}

  /** Plays the session's last turn again, as a session the service found mid-turn after its restart goes on. */
  protected replay(sessionId: string): void {
    const session = this.known.get(sessionId)!
    session.plays--
    this.play(sessionId, session.prompt)
  }

  private play(sessionId: string, prompt: string): void {
    const session = this.known.get(sessionId)!
    const task = session.entry.name!
    const turn = this.nextTurn(session)
    if (turn === undefined) throw new Error(`script: ${task} has no turn left`)
    session.plays++
    session.prompt = prompt
    const id = ++session.turn
    session.wroteAt = Date.now()
    let background = false
    const at = () => new Date().toISOString()
    session.entry = { ...session.entry, pid: SCRIPT_PID, status: 'busy', state: 'working', resting: false }
    delete session.entry.ask
    session.summary = { ...session.summary, apiError: null, checkpoint: null, noChanges: null, pullRequest: null, ask: null, asking: false, lastActivityAt: at(), turn: { startedAt: at(), tool: null } }
    this.changed()
    const cwd = session.entry.cwd
    const waiting = async (until: Promise<unknown>) => {
      this.parked++
      try {
        await until
      } finally {
        this.parked--
      }
    }
    const context: TurnContext = {
      task,
      sessionId,
      cwd,
      prompt,
      repo: this.repo(cwd),
      git: async (...args) => {
        const result = await runGit(cwd, args)
        if (result.code !== 0) throw new Error(`script: git ${args.join(' ')} in ${cwd}: ${result.out}`)
        return result.out
      },
      park: (gate) => waiting(gate.passed),
      pause: (ms) => waiting(new Promise((resolve) => setTimeout(resolve, ms))),
      show: (step) => {
        if (session.turn !== id) return
        this.writeLine(session, { at: at(), kind: step.tool === undefined ? 'text' : 'tool', text: step.text, ...(step.tool === undefined ? {} : { name: step.tool }) }, step)
      },
      mail: async (event) => {
        if (this.address === undefined) throw new Error('script: no address for the mail')
        const { host, port } = this.address()
        const response = await fetch(`http://${host}:${port}/api/sessions/${sessionId}/mail`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event }),
        })
        if (!response.ok) throw new Error(`script: mail on ${event}: ${response.status}`)
        return ((await response.json()) as { message: string | null }).message
      },
      background: () => void (background = true),
      limits: (reported) => this.onLimits?.(session.entry.account!, reported),
      tool: async (server, name, args) => {
        const url = session.mcp.find((each) => each.name === server)?.url
        if (url === undefined) throw new Error(`script: the session has no server ${server}`)
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
        })
        if (!response.ok) throw new Error(`script: ${server}/${name}: ${response.status}`)
        const { result } = (await response.json()) as { result: { content: { text: string }[]; isError?: boolean } }
        const text = result.content.map((each) => each.text).join('\n')
        if (result.isError === true) throw new Error(`script: ${server}/${name} refused: ${text}`)
        return text
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
        if (background && session.entry.resting === true) session.entry = { ...session.entry, pid: SCRIPT_PID, status: 'shell', resting: false }
        this.changed()
      })
      .finally(() => this.running.delete(running))
    this.running.add(running)
  }

  /** A line of the transcript, with what a step says about the stage and the context. */
  private writeLine(session: ScriptedSession, line: FeedLine, step: Partial<TurnStep> = {}): void {
    session.lines.push(line)
    session.wroteAt = Date.now()
    const tool = line.kind === 'tool' ? line : null
    session.summary = {
      ...session.summary,
      feed: session.lines.slice(-FEED_SIZE),
      action: line,
      stage: step.stage ?? session.summary.stage,
      contextTokens: step.context ?? session.summary.contextTokens,
      lastActivityAt: line.at,
      turn: session.summary.turn === null ? null : { ...session.summary.turn, tool: tool === null ? null : tool.text },
    }
    this.changed()
  }

  private end(session: ScriptedSession, end: TurnEnd, at: string): void {
    const { pid: _, ...rest } = session.entry
    const resting: AgentEntry = { ...rest, resting: true, status: 'idle', state: 'done' }
    const said = (text: string) => {
      this.writeLine(session, { at, kind: 'text', text })
      return { ...session.summary, lastMessage: text, lastReplyAt: at, lastActivityAt: at }
    }
    if ('crash' in end) {
      const { resting: __, status: ___, ...gone } = rest
      session.entry = { ...gone, state: 'failed' }
    } else if ('ask' in end) {
      const options = (end.options ?? ['Yes', 'No']).map((label) => ({ label, description: '' }))
      const ask = { id: `ask-${randomUUID()}`, questions: [{ question: end.ask, header: 'Question', multiSelect: false, options }] }
      session.entry = { ...session.entry, status: 'waiting', state: 'blocked', ask }
      session.summary = { ...said(end.ask), ask, asking: true }
    } else if ('limit' in end) {
      session.entry = resting
      session.summary = { ...said(end.limit), apiError: { kind: 'limit', text: end.limit, at } }
    } else if ('credit' in end) {
      session.entry = resting
      session.summary = { ...said(end.credit), apiError: { kind: 'credit', text: end.credit, at } }
    } else if ('fail' in end) {
      session.entry = resting
      session.lines.push({ at, kind: 'error', text: end.fail })
      const feed = [...session.summary.feed, { at, kind: 'error' as const, text: end.fail }]
      session.summary = { ...session.summary, feed, lastActivityAt: at, apiError: { kind: 'error', text: end.fail, at } }
    } else if ('checkpoint' in end) {
      session.entry = resting
      session.summary = { ...said(`CHECKPOINT: ${end.checkpoint}`), checkpoint: end.checkpoint }
    } else if ('noChanges' in end) {
      session.entry = resting
      session.summary = { ...said(`NO CHANGES: ${end.noChanges}`), noChanges: end.noChanges }
    } else if ('pullRequest' in end) {
      session.entry = resting
      session.summary = { ...said(`PULL REQUEST: ${end.pullRequest}`), pullRequest: end.pullRequest }
    } else {
      session.entry = resting
      session.summary = said(end.say)
    }
  }
}
