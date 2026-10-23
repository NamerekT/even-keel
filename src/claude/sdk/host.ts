import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import type { AccountHome } from '../../account/homes.js'
import { gatewayName, type SessionStart } from '../../agent/contract.js'
import { isAlive, killTree } from '../../agent/process.js'
import type { Language } from '../../language.js'
import { limitsOfRateLimitInfo, type SessionLimits } from '../../limits/model.js'
import { fail, notice, NoticeError } from '../../notice/notice.js'
import type { AgentEntry } from '../../sessions/agents.js'
import { questionsOf, replyParts, type Ask, type AskAnswers } from '../../sessions/ask.js'
import { NO_APPROVAL, permissionAsk, permissionMove } from '../../sessions/permission.js'
import { SESSION_MODE } from '../cli.js'
import type { ExecutorHello } from './executor.js'
import { ExecutorProcess, newPipe, probe, startExecutor, type ExecutorRequest } from './pipe.js'
import { sdkEntryOf, SdkRegistry, type SdkSession, type SdkTurn } from './registry.js'
import type { SdkModule, SdkOptions, SdkPermission, SdkQuery, SdkUserMessage } from './types.js'

const INIT_TIMEOUT_MS = 60_000
const ATTACH_TIMEOUT_MS = 15_000
const REMOTE_TIMEOUT_MS = 15_000
const EXIT_TIMEOUT_MS = 30_000
const EXIT_POLL_MS = 100
const ASK_TOOL = 'AskUserQuestion'

export interface SdkHostOptions {
  /** `state/claude-sdk`: the registry and the executors' logs. */
  dir: string
  /** The SDK's module, once Even Keel's copy is downloaded. */
  module: () => string | undefined
  /** The CLI the session runs on: the version the SDK goes with. */
  bin: () => string
  envOf: (home: AccountHome) => NodeJS.ProcessEnv
  /** Whether the account starts sessions with Remote Control. */
  remote: (home: AccountHome) => Promise<boolean>
  /** Read at each approval and each poll: the chain runs unattended, and nobody approves a tool call. */
  unattended: () => boolean
  /** The language a tool approval is asked in. */
  language: () => Language
  /** A session of the account reported its limits windows. */
  onLimits?: (account: string, limits: SessionLimits) => void
  log: (line: string) => void
}

/** What a reply does to a live session. */
export type ReplyMove = { kind: 'answer'; answers: AskAnswers } | { kind: 'deny'; message: string } | { kind: 'message' }

/**
 * A reply to a session that waits on a question answers the call itself when it is all answers; with words or files of
 * the user's own the call is refused with the whole reply, which the model reads as the result of the call. A session
 * that does not wait gets the reply as its next message.
 */
export function replyMove(prompt: string, ask: Ask | null): ReplyMove {
  if (ask === null) return { kind: 'message' }
  const { answers, text, files } = replyParts(prompt, ask)
  if (text === '' && files.length === 0 && Object.keys(answers).length > 0) return { kind: 'answer', answers }
  return { kind: 'deny', message: prompt.trim() }
}

interface PendingAsk {
  /** `AskUserQuestion`, or the tool whose call waits for approval. */
  tool: string
  ask: Ask
  input: Record<string, unknown>
  answer: Promise<SdkPermission>
  settle: (result: SdkPermission) => void
}

interface Connection {
  query: SdkQuery
  push: (text: string) => void
  turn: SdkTurn
  asks: Map<string, PendingAsk>
}

/**
 * Claude sessions through the Agent SDK (BTN-239). Each runs in a CLI an executor holds (`executor.ts`); the service is
 * its host while it runs and connects to it again after a restart, when the CLI asks its pending question anew.
 * A reply goes into the live CLI: no stop, no `--resume`.
 */
export class SdkSessions {
  readonly registry: SdkRegistry
  private readonly connections = new Map<string, Connection>()
  private readonly attaching = new Map<string, Promise<Connection | null>>()
  private loaded: { path: string; module: Promise<SdkModule> } | undefined

  constructor(private readonly options: SdkHostOptions) {
    this.registry = new SdkRegistry(options.dir)
  }

  /** Whether sessions can start through the SDK: its copy is downloaded. */
  ready(): boolean {
    return this.options.module() !== undefined
  }

  async knows(sessionId: string): Promise<boolean> {
    return (await this.registry.get(sessionId)) !== undefined
  }

  /** Starts a session in a new executor; `resume` — goes on in that session, whose CLI is gone. */
  async launch(home: AccountHome, start: SessionStart, resume?: SdkSession): Promise<string> {
    const failure = notice(resume === undefined ? 'claude.startFailed' : 'claude.resumeFailed', { task: start.name, cwd: start.cwd })
    const sdk = await this.sdk().catch((error: unknown) => {
      throw new NoticeError({ ...failure, detail: (error as Error).message }, { cause: error })
    })
    const sessionId = resume?.sessionId ?? randomUUID()
    const startedAt = Date.now()
    const pipe = newPipe()
    let executor: number
    try {
      executor = await startExecutor(pipe, this.registry.executorFiles(sessionId, startedAt))
    } catch (error) {
      throw new NoticeError({ ...failure, detail: (error as Error).message }, { cause: error })
    }
    const session: SdkSession = {
      sessionId,
      name: start.name,
      cwd: start.cwd,
      account: home.key,
      startedAt,
      executor,
      pipe,
      model: start.model,
      ...(resume?.bridge !== undefined && { bridge: resume.bridge }),
    }
    this.registry.save(session)
    try {
      await this.connect(home, sdk, session, start, resume !== undefined)
    } catch (error) {
      await this.kill(session)
      throw new NoticeError({ ...failure, detail: (error as Error).message }, { cause: error })
    }
    return sessionId
  }

  /** Goes on with `start.prompt` in the live CLI; `null` — the session is not live here, and the caller resumes it. */
  async reply(home: AccountHome, sessionId: string, prompt: string): Promise<string | null> {
    const session = await this.registry.get(sessionId)
    if (session === undefined || session.stopped === true) return null
    const connection = await this.connected(home, session)
    if (connection === null) return null
    const pending = [...connection.asks.values()].at(-1)
    const kind = pending !== undefined && pending.tool !== ASK_TOOL ? this.approve(connection, pending, prompt) : this.answer(connection, pending, prompt)
    this.options.log(`sessions: ${session.name}: the reply went into the live SDK session ${sessionId} (${kind})`)
    return sessionId
  }

  private answer(connection: Connection, pending: PendingAsk | undefined, prompt: string): string {
    const move = replyMove(prompt, pending?.ask ?? null)
    if (pending === undefined || move.kind === 'message') connection.push(prompt)
    else if (move.kind === 'answer') pending.settle({ behavior: 'allow', updatedInput: { ...pending.input, answers: move.answers } })
    else pending.settle({ behavior: 'deny', message: move.message })
    return pending === undefined ? 'message' : move.kind
  }

  /** The words that came with an allowed call follow it as the next message, which the session takes in the same turn. */
  private approve(connection: Connection, pending: PendingAsk, prompt: string): string {
    const move = permissionMove(prompt, pending.ask)
    if (move.kind === 'deny') {
      pending.settle({ behavior: 'deny', message: move.message })
      return `${pending.tool} denied`
    }
    pending.settle({ behavior: 'allow', updatedInput: pending.input })
    if (move.message !== null) connection.push(move.message)
    return `${pending.tool} allowed`
  }

  async resume(home: AccountHome, sessionId: string, start: SessionStart): Promise<string> {
    const session = await this.registry.get(sessionId)
    if (session === undefined) throw fail('claude.resumeFailed', { task: start.name, cwd: start.cwd })
    if ((await this.reply(home, sessionId, start.prompt)) !== null) return sessionId
    return this.launch(home, start, session)
  }

  /** Kills the executor with the CLI and what it started, mid-turn too, and waits until they are gone. */
  async stop(sessionId: string): Promise<void> {
    const session = await this.registry.get(sessionId)
    if (session === undefined || session.stopped === true) return
    if (!(await this.kill(session))) throw fail('claude.stillRunning', { agent: sessionId })
  }

  async sessions(home: AccountHome): Promise<AgentEntry[]> {
    const sessions = await this.registry.list(home.key)
    return Promise.all(
      sessions.map(async (session) => {
        if (session.stopped === true) return sdkEntryOf(session, false, null)
        const connection = await this.connected(home, session)
        if (connection !== null && this.options.unattended()) this.refuseApprovals(session, connection)
        const alive = connection !== null || (await this.alive(session))
        return sdkEntryOf(session, alive, connection?.turn ?? null)
      }),
    )
  }

  async bridge(sessionId: string): Promise<string | null> {
    return (await this.registry.get(sessionId))?.bridge ?? null
  }

  private async kill(session: SdkSession): Promise<boolean> {
    const connection = this.connections.get(session.sessionId)
    this.connections.delete(session.sessionId)
    const current = (await this.registry.get(session.sessionId)) ?? session
    if (await this.alive(current)) {
      await killTree(current.executor)
      const deadline = Date.now() + EXIT_TIMEOUT_MS
      while (isAlive(current.executor) || (current.cli !== undefined && isAlive(current.cli))) {
        if (Date.now() > deadline) return false
        await delay(EXIT_POLL_MS)
      }
    }
    connection?.query.close()
    this.registry.save({ ...current, stopped: true })
    return true
  }

  /** A pid alone may be another process by now: the executor is alive only while its pipe answers. */
  private async alive(session: SdkSession): Promise<boolean> {
    return isAlive(session.executor) && (await probe(session.pipe))
  }

  /** The connection to the session's executor; after a restart of the service it connects again. `null` — it is gone. */
  private async connected(home: AccountHome, session: SdkSession): Promise<Connection | null> {
    const known = this.connections.get(session.sessionId)
    if (known !== undefined) return known
    const running = this.attaching.get(session.sessionId)
    if (running !== undefined) return running
    if (!this.ready() || !(await this.alive(session))) return null
    const attach = this.sdk()
      .then((sdk) => this.connect(home, sdk, session, null, false))
      .catch((error: unknown) => {
        this.options.log(`sessions: could not connect to the SDK session ${session.sessionId} of ${session.name}: ${(error as Error).message}`)
        return null
      })
      .finally(() => this.attaching.delete(session.sessionId))
    this.attaching.set(session.sessionId, attach)
    return attach
  }

  /**
   * A `query` on the executor's pipe: with `start`, a new CLI with the session's options and its first prompt;
   * without, the CLI already there, which takes the SDK's `initialize` again and asks its pending questions anew.
   */
  private async connect(home: AccountHome, sdk: SdkModule, session: SdkSession, start: SessionStart | null, resumed: boolean): Promise<Connection> {
    const inbox = new Inbox()
    let hello: ExecutorHello | undefined
    const connection: Connection = {
      query: undefined as unknown as SdkQuery,
      push: (text) => {
        connection.turn = { status: 'busy', ask: null }
        inbox.push(text)
      },
      turn: { status: start === null ? 'busy' : 'idle', ask: null },
      asks: new Map(),
    }
    const request = (spawn: { command: string; args: string[]; cwd?: string; env: Record<string, string | undefined> }): ExecutorRequest =>
      start === null ? { executor: 'attach' } : { executor: 'spawn', ...spawn }
    const options: SdkOptions = {
      cwd: session.cwd,
      env: this.options.envOf(home),
      pathToClaudeCodeExecutable: this.options.bin(),
      permissionMode: SESSION_MODE,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      title: session.name,
      ...(session.model !== null && { model: session.model }),
      ...(start !== null && sessionOptions(start)),
      ...(resumed ? { resume: session.sessionId } : start !== null ? { sessionId: session.sessionId } : {}),
      canUseTool: (tool, input, { signal, toolUseID }) => this.permission(connection, tool, input, signal, toolUseID),
      spawnClaudeCodeProcess: ({ command, args, cwd, env }) =>
        new ExecutorProcess(session.pipe, request({ command, args, cwd, env }), (said) => {
          hello = said
          if (connection.asks.size === 0) connection.turn = { status: said.turn, ask: null }
        }),
    }
    const query = sdk.query({ prompt: inbox, options })
    connection.query = query
    this.connections.set(session.sessionId, connection)
    void this.pump(session, connection)
    try {
      await within(query.initializationResult(), start === null ? ATTACH_TIMEOUT_MS : INIT_TIMEOUT_MS, 'the CLI did not answer the SDK')
    } catch (error) {
      if (this.connections.get(session.sessionId) === connection) this.connections.delete(session.sessionId)
      query.close()
      throw error
    }
    if (hello?.pid != null && hello.pid !== session.cli) this.registry.save({ ...session, cli: hello.pid })
    if (start !== null) {
      await this.remoteControl(home, session, query)
      connection.push(start.prompt)
    }
    return connection
  }

  /** Remote Control with the session kept on claude.ai after the CLI exits, so that a resume goes back to it; without an answer the session runs without it. */
  private async remoteControl(home: AccountHome, session: SdkSession, query: SdkQuery): Promise<void> {
    if (query.enableRemoteControl === undefined || !(await this.options.remote(home))) return
    try {
      const reattach = session.bridge === undefined ? {} : { reattachSessionId: session.bridge }
      const answer = await within(query.enableRemoteControl(true, session.name, { keepSessionOnExit: true, ...reattach }), REMOTE_TIMEOUT_MS, 'no answer')
      const bridge = answer.bridge_session_id
      const current = (await this.registry.get(session.sessionId)) ?? session
      if (typeof bridge === 'string' && bridge !== '') this.registry.save({ ...current, bridge })
    } catch (error) {
      this.options.log(`sessions: ${session.name}: no Remote Control for the SDK session ${session.sessionId}: ${(error as Error).message}`)
    }
  }

  private async pump(session: SdkSession, connection: Connection): Promise<void> {
    try {
      for await (const message of connection.query) {
        if (message.type === 'rate_limit_event') {
          const limits = limitsOfRateLimitInfo(message.rate_limit_info)
          if (limits !== undefined) this.options.onLimits?.(session.account, limits)
          continue
        }
        if (connection.asks.size > 0) continue
        if (message.type === 'assistant') connection.turn = { status: 'busy', ask: null }
        else if (message.type === 'result') connection.turn = { status: 'idle', ask: null }
      }
    } catch (error) {
      this.options.log(`sessions: the SDK session ${session.sessionId} of ${session.name} ended: ${(error as Error).message}`)
    } finally {
      if (this.connections.get(session.sessionId) === connection) this.connections.delete(session.sessionId)
    }
  }

  /** Approvals that waited when the chain went unattended are refused at once, or the chain would stand on them all night. */
  private refuseApprovals(session: SdkSession, connection: Connection): void {
    for (const pending of [...connection.asks.values()]) {
      if (pending.tool === ASK_TOOL) continue
      pending.settle({ behavior: 'deny', message: NO_APPROVAL })
      this.options.log(`sessions: ${session.name}: the chain is unattended, the waiting approval of ${pending.tool} is refused`)
    }
  }

  /**
   * A question, or a tool call to approve, waits for the user's reply, or for an answer from Remote Control, which the
   * CLI reports by aborting the call. An unattended chain has nobody to approve a call, so it is refused.
   */
  private permission(connection: Connection, tool: string, input: Record<string, unknown>, signal: AbortSignal, toolUseID: string | undefined): Promise<SdkPermission> {
    if (tool !== ASK_TOOL && this.options.unattended()) return Promise.resolve({ behavior: 'deny', message: NO_APPROVAL })
    const id = toolUseID ?? randomUUID()
    const known = connection.asks.get(id)
    if (known !== undefined) return known.answer
    let settle: (result: SdkPermission) => void = () => {}
    const answer = new Promise<SdkPermission>((resolve) => (settle = resolve))
    const pending: PendingAsk = {
      tool,
      ask: tool === ASK_TOOL ? { id, questions: questionsOf(input) } : permissionAsk(id, tool, input, this.options.language()),
      input,
      answer,
      settle: (result) => {
        if (connection.asks.get(id) !== pending) return
        connection.asks.delete(id)
        const next = [...connection.asks.values()].at(-1)
        connection.turn = next === undefined ? { status: 'busy', ask: null } : { status: 'waiting', ask: next.ask }
        settle(result)
      },
    }
    connection.asks.set(id, pending)
    connection.turn = { status: 'waiting', ask: pending.ask }
    signal.addEventListener('abort', () => pending.settle({ behavior: 'deny', message: 'The question was answered elsewhere.' }), { once: true })
    return answer
  }

  private sdk(): Promise<SdkModule> {
    const path = this.options.module()
    if (path === undefined) return Promise.reject(new Error('the SDK is not downloaded yet'))
    if (this.loaded?.path !== path) this.loaded = { path, module: import(pathToFileURL(path).href) as Promise<SdkModule> }
    return this.loaded.module
  }
}

/** What a new CLI starts with besides the session's own name and model. */
function sessionOptions(start: SessionStart): Partial<SdkOptions> {
  const { settings, mcp, plugins = [] } = start
  return {
    ...(settings !== undefined && { settings }),
    ...(mcp !== undefined && {
      mcpServers: Object.fromEntries(mcp.map((server) => [gatewayName(server), { type: 'http' as const, url: server.url }])),
      strictMcpConfig: true,
    }),
    ...(plugins.length > 0 && { plugins: plugins.map(({ dir }) => ({ type: 'local' as const, path: dir })) }),
  }
}

/** The SDK's input: messages pushed as the chain sends them; it never ends, so the CLI waits for the next one. */
class Inbox implements AsyncIterable<SdkUserMessage> {
  private readonly queue: SdkUserMessage[] = []
  private wake: (() => void) | undefined

  push(text: string): void {
    this.queue.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
    this.wake?.()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SdkUserMessage> {
    while (true) {
      const next = this.queue.shift()
      if (next !== undefined) {
        yield next
        continue
      }
      await new Promise<void>((resolve) => (this.wake = resolve))
      this.wake = undefined
    }
  }
}

function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
