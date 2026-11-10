import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { closeSync, existsSync, openSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { AccountHome } from '../account/homes.js'
import type { AccountStatus } from '../account/model.js'
import type { OneTurnAnswer, SessionStart } from '../agent/contract.js'
import { runWithInput } from '../agent/oneturn.js'
import { isAlive, killTree, stopTree } from '../agent/process.js'
import { fail, notice, NoticeError, type Notice } from '../notice/notice.js'
import type { AgentEntry } from '../sessions/agents.js'
import type { TokenTotals } from '../sessions/transcript.js'
import { rareEvents } from '../sessions/rare.js'
import type { TurnSpend } from '../state.js'
import { mcpArgs } from './mcp.js'
import { writeProtection } from './protection.js'
import { type CodexPlugins, UntrustedHooks } from './plugins.js'
import { APPEAR_TIMEOUT_MS, polledProcessStartedAt, processBelongsToTurn, processStartedAt, turnStartedAt } from './process.js'
import { foldRollout, RolloutFold } from './rollout.js'
import { entryOf, outputTail, threadOf, turnEnded, type CodexSession, type TurnRegistry } from './turns.js'
import { windowArgs } from './window.js'

const run = promisify(execFile)

const POLL_MS = 500
const STOP_TIMEOUT_MS = 30_000
/** Loading a long rollout takes longer than a short call. */
const WARM_TIMEOUT_MS = 3 * 60_000
const TRIPLES: Record<string, string> = { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' }

/** Chain sessions run without a human: the model approves its own actions (BTN-168). */
export const SESSION_MODE = 'approve-for-me'
/** The global `execution.codex` `bypass`: from the Windows service the sandbox does not start (BTN-171). */
const BYPASS_MODE = 'dangerously-bypass-approvals-and-sandbox'

/**
 * `EVEN_KEEL_CODEX_BIN`, else Even Keel's own copy of the checked version (`pinned`), else on Windows the native
 * `codex.exe` of the global npm package (its `codex.cmd` needs a shell), else `codex` on the PATH.
 */
export function resolveCodexBinary(env: NodeJS.ProcessEnv, pinned?: string): string {
  if (env.EVEN_KEEL_CODEX_BIN) return env.EVEN_KEEL_CODEX_BIN
  if (pinned !== undefined) return pinned
  const triple = TRIPLES[process.arch]
  if (process.platform !== 'win32' || env.APPDATA === undefined || triple === undefined) return 'codex'
  const scope = join(env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai')
  const native = join(scope, `codex-win32-${process.arch}`, 'vendor', triple, 'bin', 'codex.exe')
  return existsSync(native) ? native : 'codex'
}

/** `codex exec` refuses a folder outside a repository without the flag: a project without git works in one. */
const repoCheckArgs = (outsideRepo: boolean | undefined): string[] => (outsideRepo === true ? ['--skip-git-repo-check'] : [])

/**
 * Every flag of `codex exec` goes before `resume`: the subcommand has none of its own. `plugins` — `CodexPlugins.args`.
 * A project with a `CLAUDE.md` and no `AGENTS.md` still gives the session its rules (BTN-340, checked on 0.164.0).
 */
export function turnArgs(start: Pick<SessionStart, 'model' | 'bypassSandbox' | 'mcp' | 'noMemory' | 'contextWindow' | 'outsideRepo'>, prompt: string, resumeId?: string, plugins: string[] = []): string[] {
  const { model, bypassSandbox, mcp = [] } = start
  return [
    'exec',
    '--json',
    ...repoCheckArgs(start.outsideRepo),
    `--${bypassSandbox === true ? BYPASS_MODE : SESSION_MODE}`,
    '-c',
    'project_doc_fallback_filenames=["CLAUDE.md"]',
    // The keys as `config/read` of 0.166.0 shows them (BTN-724).
    ...(start.noMemory === true ? ['-c', 'features.memories=false', '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false'] : []),
    ...windowArgs(start.contextWindow),
    ...(model === null ? [] : ['-m', model]),
    ...mcpArgs(mcp),
    ...plugins,
    ...(resumeId === undefined ? [] : ['resume', resumeId]),
    prompt,
  ]
}

/**
 * The keep-warm ping (BTN-564): a fork of the session for one turn that keeps no rollout, with the session's model,
 * servers and plugins, so that its prompt is the session's and reads its cache. Read-only refuses a tool call; the
 * hooks are off, so that a package's Stop hook takes no mail meant for the waiting session (checked on 0.164.0, BTN-677).
 */
export function warmArgs(start: Pick<SessionStart, 'model' | 'mcp' | 'contextWindow' | 'outsideRepo'>, sessionId: string, plugins: string[] = []): string[] {
  const { model, mcp = [] } = start
  return [
    'exec',
    '--json',
    ...repoCheckArgs(start.outsideRepo),
    '--ephemeral',
    '--sandbox',
    'read-only',
    '--disable',
    'hooks',
    '-c',
    'project_doc_fallback_filenames=["CLAUDE.md"]',
    ...windowArgs(start.contextWindow),
    ...(model === null ? [] : ['-m', model]),
    ...mcpArgs(mcp),
    ...plugins,
    'fork',
    sessionId,
    '-',
  ]
}

/**
 * What the ping's own request read and wrote: a fork's `turn.completed.usage` adds the source session's whole total
 * (its last `total_token_usage`) to it (codex-cli 0.164.0, BTN-677).
 */
export function forkSpend(fork: TurnSpend, source: TokenTotals): TurnSpend {
  const less = (key: keyof TokenTotals) => Math.max(0, fork.tokens[key] - source[key])
  return { ...fork, tokens: { input: less('input'), output: less('output'), cacheRead: less('cacheRead'), cacheWrite: less('cacheWrite') } }
}

/**
 * The models of the app-server's `model/list` answer (`{ data: [{ model, hidden }] }`) as `-m` takes them, the hidden
 * ones left out. Not a complete list: an API key reaches models it does not name.
 */
export function listedModels(answer: unknown): string[] {
  const data = (answer as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  return data.flatMap((entry: { model?: unknown; hidden?: unknown }) => (typeof entry?.model === 'string' && entry.hidden !== true ? [entry.model] : []))
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
  // codex-cli 0.162.1 says "Logged in using an API key", 0.164.0 "API key configured".
  if (/^(Logged in using an API key|API key configured)/m.test(text)) return { loggedIn: true, authMethod: 'api_key', ...none }
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
    if (start.protection !== undefined) await writeProtection(cwd, start.protection, start.mainBranch, start.outsideRepo === true)
    const plugins = await this.pluginArgs(home, start, cwd)
    const turn = await this.turn(home, start, turnArgs(start, start.prompt, undefined, plugins), cwd, notice('codex.startFailed', { task: name, cwd }))
    const window = start.contextWindow === undefined ? {} : { contextWindow: start.contextWindow }
    await this.saveTurn({ sessionId: turn.thread, name, cwd, account: home.key, startedAt: turn.at, pid: turn.pid, out: turn.out, ...window })
    return turn.thread
  }

  /** Codex resumes in the process's folder: the session's own, whatever `start.cwd` says; with its own window too. */
  async resume(home: AccountHome, sessionId: string, start: SessionStart): Promise<string> {
    const session = await this.known(sessionId)
    const { name, cwd } = session
    if (start.protection !== undefined) await writeProtection(cwd, start.protection, start.mainBranch, start.outsideRepo === true)
    const plugins = await this.pluginArgs(home, start, cwd)
    const own = { ...start, contextWindow: session.contextWindow }
    const turn = await this.turn(home, start, turnArgs(own, start.prompt, sessionId, plugins), cwd, notice('codex.resumeFailed', { task: name, cwd }))
    if (turn.thread !== sessionId) throw fail('codex.otherThread', { task: name, asked: sessionId, got: turn.thread })
    const { stopped: _, ...kept } = session
    await this.saveTurn({ ...kept, account: home.key, pid: turn.pid, out: turn.out })
    return sessionId
  }

  /**
   * The keep-warm ping (`warmArgs`) in the session's own folder, the prompt on stdin. The session's total is read before
   * the fork, which adds it to its own usage; the session waits, so no turn of its own moves it meanwhile.
   */
  async warm(home: AccountHome, sessionId: string, start: SessionStart): Promise<TurnSpend> {
    const { cwd, contextWindow } = await this.known(sessionId)
    const source = await foldRollout(home.dir, sessionId, new RolloutFold(0))
    if (source === undefined) throw new Error(`no rollout of ${sessionId} in ${home.dir}`)
    const plugins = await this.pluginArgs(home, start, cwd)
    const started = Date.now()
    const stdout = await runWithInput(this.bin(), warmArgs({ ...start, contextWindow }, sessionId, plugins), start.prompt, { cwd, env: this.envOf(home), timeoutMs: WARM_TIMEOUT_MS })
    return forkSpend(parseWriteAnswer(stdout, start.model, Date.now() - started).spend, source.tokens)
  }

  async stop(sessionId: string): Promise<void> {
    const session = await this.registry.get(sessionId)
    if (session === undefined || session.stopped === true) return
    if (await this.turnLive(session)) await this.stopTurn(session)
    this.registry.save({ ...session, stopped: true })
  }

  /** A turn already runs when its record is saved: a failed save must not leave an untracked process. */
  private async saveTurn(session: CodexSession): Promise<void> {
    try {
      this.registry.save(session)
    } catch (error) {
      await this.stopTurn(session)
      throw error
    }
  }

  private async stopTurn(session: CodexSession): Promise<void> {
    const { sessionId, pid, out } = session
    const ours = async () => processBelongsToTurn(await processStartedAt(pid), turnStartedAt(out))
    if (!(await ours())) return
    if (!(await stopTree(pid, ours, { termMs: STOP_TIMEOUT_MS }))) throw fail('codex.stillRunning', { session: sessionId })
  }

  async sessions(home: AccountHome): Promise<AgentEntry[]> {
    const sessions = await this.registry.list(home.key)
    return Promise.all(sessions.map(async (session) => entryOf(session, session.stopped !== true && (await this.turnLive(session)))))
  }

  /** `codex --version`: `codex-cli 0.162.1`. */
  async version(env: NodeJS.ProcessEnv, binary = this.bin()): Promise<string> {
    return (await run(binary, ['--version'], { env, timeout: this.timeoutMs, windowsHide: true })).stdout
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
      if (error instanceof UntrustedHooks) {
        const version = await this.version(this.envOf(home)).then((out) => out.trim(), () => 'codex of an unknown version')
        const hooks = error.hooks.map((hook) => `${hook.key} ${hook.status}`).join(', ')
        throw fail('codex.hooksUntrusted', { task: start.name, package: error.plugin.package }, { detail: `${version}: ${hooks}` }, { cause: error })
      }
      throw fail('codex.pluginsFailed', { task: start.name, account: home.key }, { detail: (error as Error).message }, { cause: error })
    }
  }

  private async known(sessionId: string): Promise<CodexSession> {
    const session = await this.registry.get(sessionId)
    if (session === undefined) throw fail('codex.unknownSession', { session: sessionId })
    return session
  }

  private async turnLive(session: CodexSession): Promise<boolean> {
    if (!isAlive(session.pid) || turnEnded(await outputTail(session.out))) return false
    const processAt = await polledProcessStartedAt(session.pid)
    const turnAt = turnStartedAt(session.out)
    const belongs = processBelongsToTurn(processAt, turnAt)
    if (!belongs) rareEvents.once('29', `${session.out}:${session.pid}:${processAt}`, session,
      `pid-reused pid=${session.pid} turnAt=${turnAt} processAt=${processAt}; treating the turn as ended and preserving the foreign process`)
    return belongs
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

export function outputOf(error: unknown): string {
  const { stdout, stderr } = error as { stdout?: string; stderr?: string }
  return [stderr, stdout].map((text) => text?.trim()).filter(Boolean).join(' / ')
}
