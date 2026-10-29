import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, readFileSync } from 'node:fs'
import { appendFile, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { AccountHome } from '../account/homes.js'
import type { AccountStatus } from '../account/model.js'
import { gatewayName, type OneTurn, type OneTurnAnswer, type SessionStart } from '../agent/contract.js'
import { runWithInput } from '../agent/oneturn.js'
import { passedSkillFolders } from '../agent/projectRules.js'
import { isAlive, killTree } from '../agent/process.js'
import { polledProcessStartedAt, processBelongsToTurn, processStartedAt, turnStartedAt } from '../codex/process.js'
import { entryOf, lastEvent, outputTail, type CodexSession, type TurnRegistry } from '../codex/turns.js'
import { fail, notice, NoticeError, type Notice } from '../notice/notice.js'
import { samePath } from '../paths.js'
import type { AgentEntry } from '../sessions/agents.js'
import { sessionList, sessionRows, sessionStamp } from './db.js'
import { keepOwnInstructions, parseAuth, readAuth } from './home.js'
import { OPENCODE } from './name.js'
import { protectionRules } from '../sessions/protection.js'
import { OpenCodeLog } from './log.js'
import { copilotModel, copilotOnly, copilotUnsupported } from './support.js'
import { foldSession } from './transcript.js'

const run = promisify(execFile)

/** The first event comes with the model's first chunk, which a thinking model may take a while to send. */
const APPEAR_TIMEOUT_MS = 120_000
const POLL_MS = 500
const STOP_TIMEOUT_MS = 30_000
export { hungEntry, TURN_HANG_MS } from '../sessions/silence.js'
import { hungEntry } from '../sessions/silence.js'
export const LOG_SILENCE_MS = 30_000
const STREAM_ERROR_EVENT = 'even_keel_stream_error'

/**
 * Chain sessions run without a human: OpenCode's tools are allowed by default and an `ask` is rejected on its own in
 * `run`, so the session never hangs on one. A merge into the main checkout from a worktree is `external_directory`,
 * which is allowed for chain sessions (`sessionConfig`).
 */
export const SESSION_MODE = 'default'

/** The sign-ins the page offers, as `opencode providers login` takes them through a pipe (BTN-214). */
export const LOGIN_METHODS: Readonly<Record<string, readonly string[]>> = {
  chatgpt: ['-p', 'openai', '-m', 'ChatGPT Pro/Plus (headless)'],
}

/**
 * `EVEN_KEEL_OPENCODE_BIN`, else Even Keel's own copy of the checked version (`pinned`, BTN-347), else on Windows the
 * native `opencode.exe` of the global npm package (its `opencode` on the PATH is an npm wrapper), else `opencode` on the PATH.
 */
export function resolveOpenCodeBinary(env: NodeJS.ProcessEnv, pinned?: string): string {
  if (env.EVEN_KEEL_OPENCODE_BIN) return env.EVEN_KEEL_OPENCODE_BIN
  if (pinned !== undefined) return pinned
  if (process.platform !== 'win32' || env.APPDATA === undefined) return 'opencode'
  const native = join(env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'node_modules', `opencode-windows-${process.arch}`, 'bin', 'opencode.exe')
  return existsSync(native) ? native : 'opencode'
}

/**
 * A new session is titled with its task, so its own TUI shows it by name; a resume names the session instead. The
 * prompt goes after `--`: a reply starts with `- "question" → answer`, which `run` would read as an option.
 */
export function turnArgs(start: Pick<SessionStart, 'name' | 'model'>, prompt: string, resumeId?: string): string[] {
  const { name, model } = start
  return [
    'run',
    '--format',
    'json',
    ...(model === null ? [] : ['-m', model]),
    ...(resumeId === undefined ? ['--title', name] : ['-s', resumeId]),
    '--',
    prompt,
  ]
}

/**
 * The config a chain session gets on top of the account's and the project's (`OPENCODE_CONFIG_CONTENT`): the
 * gateway's servers and none of the project's own, the skills and the OpenCode plugins of the project's plugin
 * packages, and `external_directory` allowed, which a merge into the main checkout from a worktree needs. The
 * built-in config hook reapplies Protection after agent-specific permissions have been merged.
 */
export function sessionConfig(start: Pick<SessionStart, 'mcp' | 'plugins' | 'protection'>, projectServers: string[], skillDirs: string[], plugins: string[] = []): string {
  const huly = start.mcp?.filter(server => server.plugin === 'huly' || server.name === 'huly').map(gatewayName)
  const rules = protectionRules(start.protection, [], undefined, huly).opencode
  const permission = {
    external_directory: 'allow',
    ...(rules.bash.length > 0 ? { bash: Object.fromEntries(rules.bash.map(pattern => [pattern, 'deny'])) } : {}),
    ...Object.fromEntries(rules.tools.map(tool => [tool, 'deny'])),
  }
  const config: Record<string, unknown> = { $schema: 'https://opencode.ai/config.json', permission, disabled_providers: ['github-copilot'] }
  if (start.mcp !== undefined) {
    const own = Object.fromEntries(projectServers.map((name) => [name, { enabled: false }]))
    const gateway = Object.fromEntries(start.mcp.map((server) => [gatewayName(server), { type: 'remote', url: server.url, enabled: true }]))
    config.mcp = { ...own, ...gateway }
  }
  if (skillDirs.length > 0) config.skills = { paths: skillDirs }
  const overlay = rules.bash.length > 0 || rules.tools.length > 0
    ? [[new URL(import.meta.url.endsWith('.ts') ? './protection-plugin.ts' : './protection-plugin.js', import.meta.url).href, rules]]
    : []
  if (plugins.length > 0 || overlay.length > 0) config.plugin = [...plugins, ...overlay]
  return JSON.stringify(config)
}

/**
 * The OpenCode plugins of the project's plugin packages: the scripts in a package's `opencode/` folder, as the file
 * URLs OpenCode's `plugin` key loads (the `checkpoint` package's hooks, BTN-274).
 */
export function pluginFiles(start: Pick<SessionStart, 'plugins'>): string[] {
  return (start.plugins ?? []).flatMap((plugin) => {
    const dir = join(plugin.dir, 'opencode')
    let files: string[]
    try {
      files = readdirSync(dir)
    } catch {
      return []
    }
    return files.filter((file) => /\.m?js$/.test(file)).sort().map((file) => pathToFileURL(join(dir, file)).href)
  })
}

/** The tools `Agent.write`'s turn may not use: it only reads, with Read, Grep and Glob. */
const WRITE_DENIED = ['edit', 'bash', 'webfetch', 'websearch', 'task', 'todowrite', 'skill', 'external_directory']

/**
 * `Agent.write`: one read-only turn with no one to answer it (the changelog, BTN-209), the prompt on stdin. `--pure`
 * loads no external plugin; the session it leaves in the account's database is deleted after it (`writeConfig`).
 */
export function writeArgs(model: string | null): string[] {
  return ['run', '--pure', '--format', 'json', '--title', 'Even Keel', ...(model === null ? [] : ['-m', model])]
}

/** The config of `Agent.write`'s turn: every tool but reading denied, and the project's own MCP servers off. */
export function writeConfig(projectServers: string[]): string {
  const config: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    disabled_providers: ['github-copilot'],
    permission: Object.fromEntries(WRITE_DENIED.map((tool) => [tool, 'deny'])),
  }
  if (projectServers.length > 0) config.mcp = Object.fromEntries(projectServers.map((name) => [name, { enabled: false }]))
  return JSON.stringify(config)
}

/**
 * The text of `writeArgs`' last step and every step's tokens and cost; the events do not name the model, so it is the
 * one asked for. Throws with the provider's words when the turn failed.
 */
export function parseWriteAnswer(stdout: string, model: string | null, durationMs: number): OneTurnAnswer {
  let texts: string[] = []
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let cost = 0
  const count = (value: unknown) => (typeof value === 'number' ? value : 0)
  for (const line of stdout.split('\n')) {
    const event = parse(line)
    const part = event?.part as Record<string, unknown> | undefined
    if (event?.type === 'error') throw new Error(errorOf(event.error))
    if (event?.type === 'step_start') texts = []
    if (event?.type === 'text' && typeof part?.text === 'string' && part.text.trim() !== '') texts.push(part.text.trim())
    if (event?.type !== 'step_finish') continue
    const used = (part?.tokens ?? {}) as Record<string, unknown>
    const cache = (used.cache ?? {}) as Record<string, unknown>
    tokens.input += count(used.input)
    tokens.output += count(used.output) + count(used.reasoning)
    tokens.cacheRead += count(cache.read)
    tokens.cacheWrite += count(cache.write)
    cost += count(part?.cost)
  }
  if (texts.length === 0) throw new Error('the turn ended with no message')
  return { text: texts.join('\n\n'), spend: { model, tokens, cost, durationMs } }
}

function errorOf(error: unknown): string {
  const value = (error ?? {}) as { name?: unknown; data?: { message?: unknown } }
  if (typeof value.data?.message === 'string' && value.data.message !== '') return value.data.message
  return typeof value.name === 'string' ? value.name : 'the turn failed'
}

/** The MCP servers a project's own `opencode.json(c)` declares, by name. */
export function projectServers(cwd: string): string[] {
  const names = new Set<string>()
  for (const file of ['opencode.json', 'opencode.jsonc', join('.opencode', 'opencode.json'), join('.opencode', 'opencode.jsonc')]) {
    let text: string
    try {
      text = readFileSync(join(cwd, file), 'utf8')
    } catch {
      continue
    }
    const mcp = parseJsonc(text)?.mcp
    if (typeof mcp === 'object' && mcp !== null) for (const name of Object.keys(mcp)) names.add(name)
  }
  return [...names]
}

/** JSON with comments and trailing commas, as OpenCode reads its config; `undefined` when it is not even that. */
export function parseJsonc(text: string): Record<string, unknown> | undefined {
  const bare = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_match, string: string | undefined) => string ?? '').replace(/,(\s*[}\]])/g, '$1')
  try {
    const value: unknown = JSON.parse(bare)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** The session id of a turn, from the first event of `opencode run --format json` that carries one. */
export function sessionOf(stdout: string): string | undefined {
  for (const line of stdout.split('\n')) {
    const event = parse(line)
    if (typeof event?.sessionID === 'string' && event.sessionID !== '') return event.sessionID
  }
  return undefined
}

/** The turn's last event says it is over: an error, or a step that finished for any reason but a tool call. */
export function turnEnded(stdout: string): boolean {
  const event = lastEvent(stdout)
  if (event?.type === 'error') return true
  const part = event?.part as Record<string, unknown> | undefined
  return event?.type === 'step_finish' && part?.reason !== 'tool-calls'
}

/** An error that ended a turn: OpenCode leaves no row of it in `opencode.db` (a model it does not know). */
export interface TurnError {
  at: number
  error: Record<string, unknown>
}

/** The error event a turn of the session ended on, read from the end of its output: an error is always the last event. */
export function turnError(tail: string, sessionId: string): TurnError | undefined {
  const event = lastEvent(tail)
  if (!['error', STREAM_ERROR_EVENT].includes(String(event?.type)) || event?.sessionID !== sessionId || typeof event.timestamp !== 'number') return undefined
  const error = event.error
  return { at: event.timestamp, error: typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {} }
}

/** `opencode models`: one `<provider>/<model>` a line, the models of the providers the account is signed in to. */
export function parseModels(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[^\s/]+\/\S+$/.test(line))
}

function parse(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

export class OpenCodeCli {
  private readonly logs = new OpenCodeLog()

  constructor(
    private readonly bin: () => string,
    private readonly timeoutMs: number,
    private readonly envOf: (home: AccountHome) => NodeJS.ProcessEnv,
    private readonly registry: TurnRegistry,
  ) {}

  async launch(home: AccountHome, start: SessionStart): Promise<string> {
    this.requireSupported(home, start.model)
    const { name, cwd } = start
    const turn = await this.turn(home, start, turnArgs(start, start.prompt), cwd, notice('opencode.startFailed', { task: name, cwd }))
    this.registry.save({ sessionId: turn.session, name, cwd, account: home.key, startedAt: turn.at, pid: turn.pid, out: turn.out })
    return turn.session
  }

  /** OpenCode resumes in the session's own folder, whatever `start.cwd` says. */
  async resume(home: AccountHome, sessionId: string, start: SessionStart): Promise<string> {
    this.requireSupported(home, start.model)
    const session = await this.registry.get(sessionId)
    if (session === undefined) throw fail('opencode.unknownSession', { session: sessionId })
    const { name, cwd } = session
    if (start.model === null) {
      const rows = await sessionRows(home.dir, sessionId)
      if (rows !== undefined) this.requireSupported(home, foldSession(rows.messages, []).model)
    }
    // Only a hung turn is still live here: two processes must not write one session.
    await this.endTurn(session)
    const turn = await this.turn(home, start, turnArgs(start, start.prompt, sessionId), cwd, notice('opencode.resumeFailed', { task: name, cwd }))
    if (turn.session !== sessionId) throw fail('opencode.otherSession', { task: name, asked: sessionId, got: turn.session })
    const { stopped: _, ...kept } = session
    this.registry.save({ ...kept, account: home.key, pid: turn.pid, out: turn.out })
    return sessionId
  }

  async stop(sessionId: string): Promise<void> {
    const session = await this.registry.get(sessionId)
    if (session === undefined || session.stopped === true) return
    await this.endTurn(session)
    this.registry.save({ ...session, stopped: true })
  }

  async sessions(home: AccountHome): Promise<AgentEntry[]> {
    const sessions = await this.registry.list(home.key)
    return Promise.all(
      sessions.map(async (session) => {
        const live = session.stopped !== true && (await this.turnLive(session))
        const entry = entryOf(session, live, OPENCODE)
        if (live && lastEvent(await outputTail(session.out))?.type === STREAM_ERROR_EVENT) return { ...entry, status: 'idle' }
        const changed = live ? await lastChange(home, session) : undefined
        if (changed !== undefined && Date.now() - changed >= LOG_SILENCE_MS) {
          const error = await this.logs.error(join(home.dir, 'data', 'opencode', 'log', 'opencode.log'), session.sessionId, Math.max(changed, turnStartedAt(session.out) ?? 0))
          // Recheck after the log read: another event or a changed row means the turn is no longer silent.
          if (error !== undefined && await lastChange(home, session) === changed && await this.turnLive(session)) {
            await appendFile(session.out, `\n${JSON.stringify({ type: STREAM_ERROR_EVENT, sessionID: session.sessionId, timestamp: error.at, error: { ...error.error, evenKeelStreamError: true } })}\n`)
            return { ...entry, status: 'idle' }
          }
        }
        return changed === undefined ? entry : hungEntry(entry, changed, Date.now())
      }),
    )
  }

  /** `writeArgs`' turn; its session leaves the account's database after it, so no transcript counts it as a chain session's. */
  async write(home: AccountHome, { cwd, prompt, model, timeoutMs }: OneTurn): Promise<OneTurnAnswer> {
    this.requireSupported(home, model)
    keepOwnInstructions(home.dir)
    const env = { ...this.envOf(home), PWD: cwd, OPENCODE_CONFIG_CONTENT: writeConfig(projectServers(cwd)) }
    const started = Date.now()
    const stdout = await runWithInput(this.bin(), writeArgs(model), prompt, { cwd, env, timeoutMs })
    const session = sessionOf(stdout)
    if (session !== undefined) await run(this.bin(), ['session', 'delete', session], { cwd, env, timeout: this.timeoutMs, windowsHide: true }).catch(() => {})
    return parseWriteAnswer(stdout, model, Date.now() - started)
  }

  /** `opencode models` in the account's folders: only the providers it is signed in to. */
  async models(home: AccountHome): Promise<string[]> {
    return parseModels((await run(this.bin(), ['models'], { env: this.envOf(home), timeout: this.timeoutMs, windowsHide: true })).stdout)
  }

  /** The errors the session's turns ended on, oldest first (`turnError`). */
  async turnErrors(sessionId: string): Promise<TurnError[]> {
    const session = await this.registry.get(sessionId)
    if (session === undefined) return []
    const tails = await Promise.all((await this.registry.turnFiles(session)).map(outputTail))
    return tails.flatMap((tail) => turnError(tail, sessionId) ?? [])
  }

  /** `opencode --version`: `1.18.25`. */
  async version(env: NodeJS.ProcessEnv): Promise<string> {
    return (await run(this.bin(), ['--version'], { env, timeout: this.timeoutMs, windowsHide: true })).stdout
  }

  async authStatus(home: AccountHome): Promise<AccountStatus> {
    return parseAuth(readAuth(home.dir))
  }

  private requireSupported(home: AccountHome, model: string | null): void {
    if (copilotModel(model) || copilotOnly({ agent: OPENCODE, status: parseAuth(readAuth(home.dir)) })) throw new NoticeError(copilotUnsupported())
  }

  /** A device sign-in (`LOGIN_METHODS`): the page shows the link and the code OpenCode prints. */
  login(home: AccountHome, method: string | undefined): ChildProcessWithoutNullStreams {
    const args = method === undefined ? undefined : LOGIN_METHODS[method]
    if (args === undefined) throw fail('login.method', { method: method ?? '', known: Object.keys(LOGIN_METHODS) })
    keepOwnInstructions(home.dir)
    const child = spawn(this.bin(), ['providers', 'login', ...args], { env: this.envOf(home), windowsHide: true, stdio: 'pipe' })
    return child
  }

  /** Signing out of every provider is dropping the account's credentials. */
  async logout(home: AccountHome): Promise<void> {
    await rm(join(home.dir, 'data', 'opencode', 'auth.json'), { force: true })
  }

  private async turnLive(session: CodexSession): Promise<boolean> {
    return isAlive(session.pid) && !turnEnded(await outputTail(session.out))
      && processBelongsToTurn(await polledProcessStartedAt(session.pid), turnStartedAt(session.out), APPEAR_TIMEOUT_MS)
  }

  private async endTurn(session: CodexSession): Promise<void> {
    if (!(await this.turnLive(session))) return
    if (!processBelongsToTurn(await processStartedAt(session.pid), turnStartedAt(session.out), APPEAR_TIMEOUT_MS)) return
    await killTree(session.pid)
    const deadline = Date.now() + STOP_TIMEOUT_MS
    while (isAlive(session.pid)) {
      if (Date.now() > deadline) throw fail('opencode.stillRunning', { session: session.sessionId })
      await delay(POLL_MS)
    }
  }

  /**
   * A turn is a detached process writing its JSON events into a file, as Codex's is. OpenCode takes its working folder
   * from `PWD` before the process's own, so `PWD` is set too. The session id is in its first event; a turn that sends
   * none yet is found in the account's database by its title.
   */
  private async turn(home: AccountHome, start: SessionStart, args: string[], cwd: string, failure: Notice): Promise<{ session: string; pid: number; out: string; at: number }> {
    keepOwnInstructions(home.dir)
    const config = sessionConfig(start, projectServers(cwd), skillDirs(start, cwd), pluginFiles(start))
    const at = Date.now()
    const out = this.registry.turnFile(start.name, at)
    const fd = openSync(out, 'a')
    let exited = false
    let child
    try {
      child = spawn(this.bin(), args, {
        cwd,
        env: { ...this.envOf(home), PWD: cwd, OPENCODE_CONFIG_CONTENT: config },
        detached: true,
        stdio: ['ignore', fd, fd],
        windowsHide: true,
      })
      child.on('error', () => (exited = true))
      child.on('exit', () => (exited = true))
      child.unref()
    } catch (error) {
      throw new NoticeError({ ...failure, detail: (error as Error).message }, { cause: error })
    } finally {
      closeSync(fd)
    }
    const deadline = at + APPEAR_TIMEOUT_MS
    const resuming = args.slice(0, args.indexOf('--')).includes('-s')
    for (;;) {
      const text = await readFile(out, 'utf8').catch(() => '')
      const session = sessionOf(text) ?? (resuming ? undefined : await this.titled(home, start.name, cwd, at))
      if (session !== undefined && child.pid !== undefined) return { session, pid: child.pid, out, at }
      if (exited || Date.now() > deadline) {
        if (!exited && child.pid !== undefined) await killTree(child.pid)
        throw new NoticeError({ ...failure, detail: text.trim().slice(-500) })
      }
      await delay(POLL_MS)
    }
  }

  private async titled(home: AccountHome, title: string, cwd: string, since: number): Promise<string | undefined> {
    const found = (await sessionList(home.dir)).find((session) => session.title === title && session.createdAt >= since && samePath(session.directory, cwd))
    return found?.id
  }
}

/**
 * The last sign of a turn's life: a row of its session changed, or an event written into its output; `undefined` when
 * the database could not be read this time (a WAL checkpoint), so one failed read does not take the turn for hung.
 */
async function lastChange(home: AccountHome, session: CodexSession): Promise<number | undefined> {
  const [rows, out] = await Promise.all([sessionStamp(home.dir, session.sessionId), stat(session.out).catch(() => undefined)])
  return rows === undefined ? undefined : Math.max(rows, out?.mtimeMs ?? 0)
}

/**
 * The plugin packages' `skills/` and the project's own skill folders `OPENCODE_DISABLE_EXTERNAL_SKILLS` drops along with
 * `~/.claude/skills` and `~/.agents/skills` (OpenCode 1.18.25, BTN-340).
 */
export function skillDirs(start: Pick<SessionStart, 'plugins'>, cwd: string): string[] {
  const own = passedSkillFolders(OPENCODE).map((folder) => join(cwd, ...folder.split('/')))
  return [...(start.plugins ?? []).map((plugin) => join(plugin.dir, 'skills')), ...own].filter((dir) => existsSync(dir))
}
