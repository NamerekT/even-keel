import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { AccountHome } from '../account/homes.js'
import type { AccountStatus } from '../account/model.js'
import { gatewayName, type SessionStart } from '../agent/contract.js'
import { isAlive, killTree } from '../agent/process.js'
import { entryOf, outputTail, type CodexSession, type TurnRegistry } from '../codex/turns.js'
import { fail, notice, NoticeError, type Notice } from '../notice/notice.js'
import { samePath } from '../paths.js'
import type { AgentEntry } from '../sessions/agents.js'
import { sessionList } from './db.js'
import { keepOwnInstructions, parseAuth, readAuth } from './home.js'
import { OPENCODE } from './name.js'

const run = promisify(execFile)

/** The first event comes with the model's first chunk, which a thinking model may take a while to send. */
const APPEAR_TIMEOUT_MS = 120_000
const POLL_MS = 500
const STOP_TIMEOUT_MS = 30_000
/** Copilot's sign-in asks GitHub.com or Enterprise first; Enter takes GitHub.com. */
const SELECT_DELAY_MS = 3_000

/**
 * Chain sessions run without a human: OpenCode's tools are allowed by default and an `ask` is rejected on its own in
 * `run`, so the session never hangs on one. A merge into the main checkout from a worktree is `external_directory`,
 * which is allowed for chain sessions (`sessionConfig`).
 */
export const SESSION_MODE = 'default'

/** The sign-ins the page offers, as `opencode providers login` takes them through a pipe (BTN-214). */
export const LOGIN_METHODS: Readonly<Record<string, readonly string[]>> = {
  chatgpt: ['-p', 'openai', '-m', 'ChatGPT Pro/Plus (headless)'],
  copilot: ['-p', 'github-copilot', '-m', 'Login with GitHub Copilot'],
}

/**
 * `EVEN_KEEL_OPENCODE_BIN`, else on Windows the native `opencode.exe` of the global npm package (its `opencode` on
 * the PATH is an npm wrapper), else `opencode` on the PATH.
 */
export function resolveOpenCodeBinary(env: NodeJS.ProcessEnv): string {
  if (env.EVEN_KEEL_OPENCODE_BIN) return env.EVEN_KEEL_OPENCODE_BIN
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
 * gateway's servers and none of the project's own, the skills of the project's plugin packages, and
 * `external_directory` allowed, which a merge into the main checkout from a worktree needs.
 */
export function sessionConfig(start: Pick<SessionStart, 'mcp' | 'plugins'>, projectServers: string[], skillDirs: string[]): string {
  const config: Record<string, unknown> = { $schema: 'https://opencode.ai/config.json', permission: { external_directory: 'allow' } }
  if (start.mcp !== undefined) {
    const own = Object.fromEntries(projectServers.map((name) => [name, { enabled: false }]))
    const gateway = Object.fromEntries(start.mcp.map((server) => [gatewayName(server), { type: 'remote', url: server.url, enabled: true }]))
    config.mcp = { ...own, ...gateway }
  }
  if (skillDirs.length > 0) config.skills = { paths: skillDirs }
  return JSON.stringify(config)
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
  const event = parse(stdout.trimEnd().split('\n').at(-1) ?? '')
  if (event?.type === 'error') return true
  const part = event?.part as Record<string, unknown> | undefined
  return event?.type === 'step_finish' && part?.reason !== 'tool-calls'
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
  constructor(
    private readonly bin: () => string,
    private readonly timeoutMs: number,
    private readonly envOf: (home: AccountHome) => NodeJS.ProcessEnv,
    private readonly registry: TurnRegistry,
  ) {}

  async launch(home: AccountHome, start: SessionStart): Promise<string> {
    const { name, cwd } = start
    const turn = await this.turn(home, start, turnArgs(start, start.prompt), cwd, notice('opencode.startFailed', { task: name, cwd }))
    this.registry.save({ sessionId: turn.session, name, cwd, account: home.key, startedAt: turn.at, pid: turn.pid, out: turn.out })
    return turn.session
  }

  /** OpenCode resumes in the session's own folder, whatever `start.cwd` says. */
  async resume(home: AccountHome, sessionId: string, start: SessionStart): Promise<string> {
    const session = await this.registry.get(sessionId)
    if (session === undefined) throw fail('opencode.unknownSession', { session: sessionId })
    const { name, cwd } = session
    const turn = await this.turn(home, start, turnArgs(start, start.prompt, sessionId), cwd, notice('opencode.resumeFailed', { task: name, cwd }))
    if (turn.session !== sessionId) throw fail('opencode.otherSession', { task: name, asked: sessionId, got: turn.session })
    const { stopped: _, ...kept } = session
    this.registry.save({ ...kept, account: home.key, pid: turn.pid, out: turn.out })
    return sessionId
  }

  async stop(sessionId: string): Promise<void> {
    const session = await this.registry.get(sessionId)
    if (session === undefined || session.stopped === true) return
    if (await this.turnLive(session)) {
      await killTree(session.pid)
      const deadline = Date.now() + STOP_TIMEOUT_MS
      while (isAlive(session.pid)) {
        if (Date.now() > deadline) throw fail('opencode.stillRunning', { session: sessionId })
        await delay(POLL_MS)
      }
    }
    this.registry.save({ ...session, stopped: true })
  }

  async sessions(home: AccountHome): Promise<AgentEntry[]> {
    const sessions = await this.registry.list(home.key)
    return Promise.all(sessions.map(async (session) => entryOf(session, session.stopped !== true && (await this.turnLive(session)), OPENCODE)))
  }

  /** `opencode --version`: `1.18.25`. */
  async version(env: NodeJS.ProcessEnv): Promise<string> {
    return (await run(this.bin(), ['--version'], { env, timeout: this.timeoutMs, windowsHide: true })).stdout
  }

  async authStatus(home: AccountHome): Promise<AccountStatus> {
    return parseAuth(readAuth(home.dir))
  }

  /** A device sign-in (`LOGIN_METHODS`): the page shows the link and the code OpenCode prints. */
  login(home: AccountHome, method: string | undefined): ChildProcessWithoutNullStreams {
    const args = method === undefined ? undefined : LOGIN_METHODS[method]
    if (args === undefined) throw fail('login.method', { method: method ?? '', known: Object.keys(LOGIN_METHODS) })
    keepOwnInstructions(home.dir)
    const child = spawn(this.bin(), ['providers', 'login', ...args], { env: this.envOf(home), windowsHide: true, stdio: 'pipe' })
    if (method === 'copilot') {
      const timer = setTimeout(() => child.stdin.write('\r'), SELECT_DELAY_MS)
      child.on('exit', () => clearTimeout(timer))
    }
    return child
  }

  /** Signing out of every provider is dropping the account's credentials. */
  async logout(home: AccountHome): Promise<void> {
    await rm(join(home.dir, 'data', 'opencode', 'auth.json'), { force: true })
  }

  private async turnLive(session: CodexSession): Promise<boolean> {
    return isAlive(session.pid) && !turnEnded(await outputTail(session.out))
  }

  /**
   * A turn is a detached process writing its JSON events into a file, as Codex's is. OpenCode takes its working folder
   * from `PWD` before the process's own, so `PWD` is set too. The session id is in its first event; a turn that sends
   * none yet is found in the account's database by its title.
   */
  private async turn(home: AccountHome, start: SessionStart, args: string[], cwd: string, failure: Notice): Promise<{ session: string; pid: number; out: string; at: number }> {
    keepOwnInstructions(home.dir)
    const config = sessionConfig(start, projectServers(cwd), skillDirs(start))
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

function skillDirs(start: Pick<SessionStart, 'plugins'>): string[] {
  return (start.plugins ?? []).map((plugin) => join(plugin.dir, 'skills')).filter((dir) => existsSync(dir))
}
