import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { closeSync, existsSync, openSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { AccountHome } from '../account/homes.js'
import type { AccountStatus } from '../account/model.js'
import type { OneTurnAnswer, SessionStart } from '../agent/contract.js'
import { fail, notice, NoticeError, type Notice } from '../notice/notice.js'
import type { AgentEntry } from '../sessions/agents.js'
import { mcpArgs } from './mcp.js'
import type { CodexPlugins } from './plugins.js'
import { entryOf, outputTail, threadOf, turnEnded, type CodexSession, type TurnRegistry } from './turns.js'

const run = promisify(execFile)

const APPEAR_TIMEOUT_MS = 60_000
const POLL_MS = 500
const STOP_TIMEOUT_MS = 30_000
const TRIPLES: Record<string, string> = { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' }

/** Chain sessions run without a human: the model approves its own actions (BTN-168). */
export const SESSION_MODE = 'approve-for-me'
/** The global `execution.codex` `bypass`: from the Windows service the sandbox does not start (BTN-171). */
const BYPASS_MODE = 'dangerously-bypass-approvals-and-sandbox'

/**
 * `EVEN_KEEL_CODEX_BIN`, else on Windows the native `codex.exe` of the global npm package (its `codex.cmd` needs a
 * shell), else `codex` on the PATH.
 */
export function resolveCodexBinary(env: NodeJS.ProcessEnv): string {
  if (env.EVEN_KEEL_CODEX_BIN) return env.EVEN_KEEL_CODEX_BIN
  const triple = TRIPLES[process.arch]
  if (process.platform !== 'win32' || env.APPDATA === undefined || triple === undefined) return 'codex'
  const scope = join(env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai')
  const native = join(scope, `codex-win32-${process.arch}`, 'vendor', triple, 'bin', 'codex.exe')
  return existsSync(native) ? native : 'codex'
}

/** Every flag of `codex exec` goes before `resume`: the subcommand has none of its own. `plugins` — `CodexPlugins.args`. */
export function turnArgs(start: Pick<SessionStart, 'model' | 'bypassSandbox' | 'mcp'>, prompt: string, resumeId?: string, plugins: string[] = []): string[] {
  const { model, bypassSandbox, mcp = [] } = start
  return [
    'exec',
    '--json',
    `--${bypassSandbox === true ? BYPASS_MODE : SESSION_MODE}`,
    ...(model === null ? [] : ['-m', model]),
    ...mcpArgs(mcp),
    ...plugins,
    ...(resumeId === undefined ? [] : ['resume', resumeId]),
    prompt,
  ]
}

/**
 * `Agent.write`: one read-only turn with no one to answer it (the changelog, BTN-209). `--json` prints its events, for
 * the tokens of `turn.completed`.
 */
export function writeArgs(model: string | null): string[] {
  return ['exec', '--json', '--sandbox', 'read-only', '--ephemeral', '--color', 'never', ...(model === null ? [] : ['-m', model]), '-']
}

/**
 * The last message of `writeArgs`' turn and its tokens; Codex counts no cost. `input_tokens` holds the cached ones;
 * the events do not name the model, so it is the one asked for.
 */
export function parseWriteAnswer(stdout: string, model: string | null, durationMs: number): OneTurnAnswer {
  let text: string | null = null
  let usage: Record<string, unknown> = {}
  for (const line of stdout.split('\n')) {
    const event = parseEvent(line)
    const item = event?.item as Record<string, unknown> | undefined
    if (event?.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') text = item.text
    if (event?.type === 'turn.completed') usage = (event.usage as Record<string, unknown> | undefined) ?? {}
    if (event?.type === 'turn.failed') throw new Error(String((event.error as { message?: unknown } | undefined)?.message ?? 'the turn failed'))
  }
  if (text === null) throw new Error('the turn ended with no message')
  const count = (value: unknown) => (typeof value === 'number' ? value : 0)
  const cached = count(usage.cached_input_tokens)
  return {
    text: text.trim(),
    spend: { model, tokens: { input: count(usage.input_tokens) - cached, output: count(usage.output_tokens), cacheRead: cached, cacheWrite: 0 }, cost: null, durationMs },
  }
}

function parseEvent(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

export function parseLoginStatus(text: string, authFile: string | undefined): AccountStatus {
  const none = { email: null, orgName: null, subscriptionType: null }
  if (/^Not logged in/m.test(text)) return { loggedIn: false, authMethod: null, ...none }
  if (/^Logged in using an API key/m.test(text)) return { loggedIn: true, authMethod: 'api_key', ...none }
  if (!/^Logged in using ChatGPT/m.test(text)) throw fail('codex.statusUnreadable', {}, { detail: text.trim().slice(0, 200) })
  const claims = tokenClaims(authFile)
  const plan = (claims?.['https://api.openai.com/auth'] as Record<string, unknown> | undefined)?.chatgpt_plan_type
  return {
    loggedIn: true,
    authMethod: 'chatgpt',
    email: typeof claims?.email === 'string' ? claims.email : null,
    orgName: null,
    subscriptionType: typeof plan === 'string' ? plan : null,
  }
}

function tokenClaims(authFile: string | undefined): Record<string, unknown> | undefined {
  try {
    const token: unknown = JSON.parse(authFile ?? '')?.tokens?.id_token
    if (typeof token !== 'string') return undefined
    const claims: unknown = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))
    return typeof claims === 'object' && claims !== null ? (claims as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

export class CodexCli {
  constructor(
    private readonly bin: () => string,
    private readonly timeoutMs: number,
    private readonly envOf: (home: AccountHome) => NodeJS.ProcessEnv,
    private readonly registry: TurnRegistry,
    private readonly plugins: CodexPlugins,
  ) {}

  async launch(home: AccountHome, start: SessionStart): Promise<string> {
    const { name, cwd } = start
    const plugins = await this.pluginArgs(home, start, cwd)
    const turn = await this.turn(home, start, turnArgs(start, start.prompt, undefined, plugins), cwd, notice('codex.startFailed', { task: name, cwd }))
    this.registry.save({ sessionId: turn.thread, name, cwd, account: home.key, startedAt: turn.at, pid: turn.pid, out: turn.out })
    return turn.thread
  }

  /** Codex resumes in the process's folder: the session's own, whatever `start.cwd` says. */
  async resume(home: AccountHome, sessionId: string, start: SessionStart): Promise<string> {
    const session = await this.known(sessionId)
    const { name, cwd } = session
    const plugins = await this.pluginArgs(home, start, cwd)
    const turn = await this.turn(home, start, turnArgs(start, start.prompt, sessionId, plugins), cwd, notice('codex.resumeFailed', { task: name, cwd }))
    if (turn.thread !== sessionId) throw fail('codex.otherThread', { task: name, asked: sessionId, got: turn.thread })
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
        if (Date.now() > deadline) throw fail('codex.stillRunning', { session: sessionId })
        await delay(POLL_MS)
      }
    }
    this.registry.save({ ...session, stopped: true })
  }

  async sessions(home: AccountHome): Promise<AgentEntry[]> {
    const sessions = await this.registry.list(home.key)
    return Promise.all(sessions.map(async (session) => entryOf(session, session.stopped !== true && (await this.turnLive(session)))))
  }

  /** `codex --version`: `codex-cli 0.162.1`. */
  async version(env: NodeJS.ProcessEnv): Promise<string> {
    return (await run(this.bin(), ['--version'], { env, timeout: this.timeoutMs, windowsHide: true })).stdout
  }

  async authStatus(home: AccountHome): Promise<AccountStatus> {
    const options = { env: this.envOf(home), timeout: this.timeoutMs, windowsHide: true }
    const output = await run(this.bin(), ['login', 'status'], options).then(
      ({ stdout, stderr }) => `${stdout}\n${stderr}`,
      (error: unknown) => {
        const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string }
        if (`${stdout}${stderr}`.trim() === '') throw error
        return `${stdout}\n${stderr}`
      },
    )
    return parseLoginStatus(output.trim(), await readFile(join(home.dir, 'auth.json'), 'utf8').catch(() => undefined))
  }

  /** The device code flow: the page shows the link and the code Codex prints. */
  login(home: AccountHome): ChildProcessWithoutNullStreams {
    return spawn(this.bin(), ['login', '--device-auth'], { env: this.envOf(home), windowsHide: true, stdio: 'pipe' })
  }

  async logout(home: AccountHome): Promise<void> {
    try {
      await run(this.bin(), ['logout'], { env: this.envOf(home), timeout: this.timeoutMs, windowsHide: true })
    } catch (error) {
      throw fail('codex.signOutFailed', { account: home.key }, { detail: outputOf(error) }, { cause: error })
    }
  }

  private async pluginArgs(home: AccountHome, start: SessionStart, cwd: string): Promise<string[]> {
    if (start.plugins === undefined) return []
    try {
      return await this.plugins.args(home, cwd, start.plugins)
    } catch (error) {
      throw fail('codex.pluginsFailed', { task: start.name, account: home.key }, { detail: (error as Error).message }, { cause: error })
    }
  }

  private async known(sessionId: string): Promise<CodexSession> {
    const session = await this.registry.get(sessionId)
    if (session === undefined) throw fail('codex.unknownSession', { session: sessionId })
    return session
  }

  private async turnLive(session: CodexSession): Promise<boolean> {
    return isAlive(session.pid) && !turnEnded(await outputTail(session.out))
  }

  /**
   * A turn is a detached process writing its `--json` stream into a file, not a pipe: it outlives the service, and
   * a pipe closed by a dead parent would kill it. Its thread id is its first event.
   */
  private async turn(
    home: AccountHome,
    start: SessionStart,
    args: string[],
    cwd: string,
    failure: Notice,
  ): Promise<{ thread: string; pid: number; out: string; at: number }> {
    const at = Date.now()
    const out = this.registry.turnFile(start.name, at)
    const fd = openSync(out, 'a')
    let exited = false
    let child
    try {
      child = spawn(this.bin(), args, {
        cwd,
        env: this.envOf(home),
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
    for (;;) {
      const text = await readFile(out, 'utf8').catch(() => '')
      const thread = threadOf(text)
      if (thread !== undefined && child.pid !== undefined) return { thread, pid: child.pid, out, at }
      if (exited || Date.now() > deadline) {
        if (!exited && child.pid !== undefined) await killTree(child.pid)
        throw new NoticeError({ ...failure, detail: text.trim().slice(-500) })
      }
      await delay(POLL_MS)
    }
  }
}

async function killTree(pid: number): Promise<void> {
  try {
    if (process.platform === 'win32') await run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    else process.kill(-pid, 'SIGTERM')
  } catch {
    if (process.platform !== 'win32') {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // already gone
      }
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function outputOf(error: unknown): string {
  const { stdout, stderr } = error as { stdout?: string; stderr?: string }
  return [stderr, stdout].map((text) => text?.trim()).filter(Boolean).join(' / ')
}
