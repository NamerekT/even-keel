import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { AccountHome } from '../account/homes.js'
import { parseAuthStatus, type AccountStatus } from '../account/model.js'
import { gatewayName, type OneTurn, type OneTurnAnswer, type SessionStart } from '../agent/contract.js'
import { runWithInput } from '../agent/oneturn.js'
import { fail, notice, NoticeError, type Notice } from '../notice/notice.js'
import { samePath } from '../paths.js'
import { blockedAsk, blockedOn, launchedModel, launchedSettings, parseAgents, parseSessionRecord, withLiveRecords, type AgentEntry, type SessionRecord } from '../sessions/agents.js'
import { newestExtensionBinary } from '../sessions/paths.js'
import type { TurnSpend } from '../state.js'
import { CallTimeout, FolderCalls } from './calls.js'
import { contextArgs } from './context.js'
import { daemonVersionOf, noDaemonIn } from './release.js'
import { descendantsOf, killLeftovers, sessionProcessAlive } from './tree.js'

const run = promisify(execFile)

const APPEAR_TIMEOUT_MS = 30_000
const APPEAR_POLL_MS = 250
const EXIT_POLL_MS = 100
const CLOCK_SKEW_MS = 5_000
const WARM_TIMEOUT_MS = 3 * 60_000

/** `EVEN_KEEL_CLAUDE_BIN`, else Even Keel's own copy of the checked version (`pinned`), else the installed CLI. */
export function resolveClaudeBinary(env: NodeJS.ProcessEnv, pinned?: string): string {
  if (env.EVEN_KEEL_CLAUDE_BIN) return env.EVEN_KEEL_CLAUDE_BIN
  if (pinned !== undefined) return pinned
  const standalone = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
  if (existsSync(standalone)) return standalone
  const extensions = join(homedir(), '.vscode', 'extensions')
  let dirs: string[] = []
  try {
    dirs = readdirSync(extensions)
  } catch {
    return 'claude'
  }
  const newest = newestExtensionBinary(dirs)
  if (newest === undefined) return 'claude'
  return join(extensions, newest, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude')
}

/** `claude plugin marketplace update`: the CLI fetches the marketplace into the configuration folder `env` names. */
export async function updateMarketplace(env: NodeJS.ProcessEnv, marketplace: string, timeoutMs: number, binary = resolveClaudeBinary(env)): Promise<void> {
  await run(binary, ['plugin', 'marketplace', 'update', marketplace], { env, timeout: timeoutMs, windowsHide: true })
}

/** `claude plugin marketplace add <dir>`: the configuration folder `env` names learns a marketplace kept in a folder. */
export async function addMarketplace(env: NodeJS.ProcessEnv, dir: string, timeoutMs: number, binary = resolveClaudeBinary(env)): Promise<void> {
  await run(binary, ['plugin', 'marketplace', 'add', dir], { env, timeout: timeoutMs, windowsHide: true })
}

export class ClaudeCli {
  constructor(
    private readonly bin: () => string,
    private readonly timeoutMs: number,
    private readonly envOf: (home: AccountHome) => NodeJS.ProcessEnv,
    private readonly calls = new FolderCalls(),
  ) {}

  async agents(home: AccountHome): Promise<AgentEntry[]> {
    const { stdout } = await this.call(home, ['agents', '--json', '--all'], undefined, 16 * 1024 * 1024)
    return withJobFiles(home, withLiveRecords(parseAgents(stdout, home.key), await liveRecords(home)))
  }

  /** `claude --version`: `2.1.303 (Claude Code)`. */
  async version(env: NodeJS.ProcessEnv): Promise<string> {
    return (await run(this.bin(), ['--version'], { env, timeout: this.timeoutMs, windowsHide: true })).stdout
  }

  async authStatus(home: AccountHome): Promise<AccountStatus> {
    const stdout = await this.call(home, ['auth', 'status', '--json']).then(
      (result) => result.stdout,
      (error: unknown) => {
        const output = (error as { stdout?: string }).stdout ?? ''
        if (output.trim() === '') throw new Error(`claude auth status in ${home.key}: ${callFailure(error)}`, { cause: error })
        return output
      },
    )
    return parseAuthStatus(stdout)
  }

  async usage(home: AccountHome, cwd: string): Promise<string> {
    try {
      return (await this.call(home, ['-p', '/usage', '--output-format', 'json', '--no-session-persistence'], cwd)).stdout
    } catch (error) {
      throw new Error(callFailure(error), { cause: error })
    }
  }

  /** `claude -p /context`: a local command, no turn; spawned directly, as Git Bash would make it a paid turn. */
  async context(home: AccountHome, cwd: string, model: string, settings?: string): Promise<string> {
    try {
      return (await this.call(home, contextArgs(model, settings), cwd)).stdout
    } catch (error) {
      throw new Error(callFailure(error), { cause: error })
    }
  }

  /** A short call that may renew the folder's sign-in: through `FolderCalls`, one at a time and never killed on a timeout. */
  private call(home: AccountHome, args: string[], cwd?: string, maxBuffer?: number) {
    return this.calls.run(home.dir, this.bin(), args, { cwd, env: this.envOf(home), timeoutMs: this.timeoutMs, maxBuffer })
  }

  async write(home: AccountHome, { cwd, prompt, model, timeoutMs }: OneTurn): Promise<OneTurnAnswer> {
    return parseWriteAnswer(await runWithInput(this.bin(), writeArgs(model), prompt, { cwd, env: this.envOf(home), timeoutMs }))
  }

  /** The keep-warm ping of a session (`warmArgs`) in its own folder; loading a long transcript takes longer than a short call. */
  async warm(home: AccountHome, sessionId: string, cwd: string, prompt: string, model: string | null, extras: SessionExtras): Promise<TurnSpend> {
    return parseWarmAnswer(await runWithInput(this.bin(), warmArgs(sessionId, model, extras), prompt, { cwd, env: this.envOf(home), timeoutMs: WARM_TIMEOUT_MS }), model)
  }

  authLogin(home: AccountHome): ChildProcessWithoutNullStreams {
    return spawn(this.bin(), ['auth', 'login', '--claudeai'], { env: this.envOf(home), windowsHide: true, stdio: 'pipe' })
  }

  async authLogout(home: AccountHome): Promise<void> {
    try {
      await run(this.bin(), ['auth', 'logout'], { env: this.envOf(home), timeout: this.timeoutMs, windowsHide: true })
    } catch (error) {
      throw fail('claude.signOutFailed', { account: home.key }, { detail: outputOf(error) }, { cause: error })
    }
  }

  async launch(home: AccountHome, task: string, cwd: string, prompt: string, model: string | null, extras: SessionExtras = {}): Promise<AgentEntry> {
    const launchedAt = Date.now()
    await this.start(home, [...sessionArgs(task, model, extras), promptArg(prompt)], cwd, notice('claude.startFailed', { task, cwd }))
    return this.appear(home, launchedAs(task, cwd, launchedAt), notice('claude.notShown', { task }))
  }

  async resume(
    home: AccountHome,
    agentId: string,
    sessionId: string,
    task: string,
    cwd: string,
    prompt: string,
    model: string | null,
    extras: SessionExtras = {},
  ): Promise<AgentEntry> {
    const resumedAt = Date.now()
    const kept = existsSync(join(home.dir, 'jobs', agentId, 'state.json'))
    const args = resumeArgs(sessionId, prompt, kept, task, model, extras)
    await this.start(home, args, cwd, notice('claude.resumeFailed', { task, cwd }))
    return this.appear(home, resumedAs(agentId, sessionId, task, cwd, resumedAt), notice('claude.resumedNotShown', { task }))
  }

  /**
   * `claude stop`, then waits for the session's process to exit and kills what it left. The exit is watched by its pid,
   * `claude agents` only confirms it. The Windows process listing takes 1–2 s, so it runs alongside the stop: an orphan
   * keeps its `ParentProcessId` there, while `ps` is taken first, before orphans are reparented.
   */
  async stop(home: AccountHome, agentId: string, sessionId: string): Promise<void> {
    const running = (await this.agents(home)).find((entry) => entry.sessionId === sessionId)
    if (running === undefined || isGone(running)) return
    if (running.pid !== undefined && !(await sessionProcessAlive(running.pid, running.processStartedAt, true))) return
    const children = running.pid === undefined ? Promise.resolve([]) : descendantsOf({ pid: running.pid, startedAt: running.processStartedAt })
    if (process.platform !== 'win32') await children
    try {
      await run(this.bin(), ['stop', agentId], { env: this.envOf(home), timeout: this.timeoutMs, windowsHide: true })
    } catch (error) {
      throw fail('claude.stopFailed', { agent: agentId }, { detail: outputOf(error) }, { cause: error })
    }
    const deadline = Date.now() + APPEAR_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (await sessionProcessAlive(running.pid, running.processStartedAt)) {
        await delay(EXIT_POLL_MS)
        continue
      }
      if (isGone((await this.agents(home)).find((entry) => entry.sessionId === sessionId))) {
        await killLeftovers(await children)
        return
      }
      await delay(APPEAR_POLL_MS)
    }
    throw fail('claude.stillRunning', { agent: agentId })
  }

  /** `claude daemon status`: the version of the folder's daemon, `null` — none runs. */
  async daemonVersion(home: AccountHome): Promise<string | null> {
    try {
      const { stdout } = await run(this.bin(), ['daemon', 'status'], { env: this.envOf(home), timeout: this.timeoutMs, windowsHide: true })
      return daemonVersionOf(stdout)
    } catch (error) {
      const { stdout } = error as { stdout?: unknown }
      if (typeof stdout === 'string' && noDaemonIn(stdout)) return null
      throw fail('claude.daemonStatusFailed', { account: home.key }, { detail: callFailure(error) }, { cause: error })
    }
  }

  async stopDaemon(home: AccountHome): Promise<void> {
    try {
      await run(this.bin(), ['daemon', 'stop', '--any'], { env: this.envOf(home), timeout: this.timeoutMs, windowsHide: true })
    } catch (error) {
      throw fail('claude.daemonStopFailed', { account: home.key }, { detail: outputOf(error) }, { cause: error })
    }
  }

  private async start(home: AccountHome, args: string[], cwd: string, failure: Notice): Promise<void> {
    try {
      await run(this.bin(), args, { cwd, env: this.envOf(home), timeout: this.timeoutMs, windowsHide: true })
    } catch (error) {
      throw new NoticeError({ ...failure, detail: outputOf(error) }, { cause: error })
    }
  }

  private async appear(home: AccountHome, match: (agent: AgentEntry) => boolean, failure: Notice): Promise<AgentEntry> {
    const deadline = Date.now() + APPEAR_TIMEOUT_MS
    while (Date.now() < deadline) {
      const found = (await this.agents(home)).find(match)
      if (found !== undefined) return found
      await delay(APPEAR_POLL_MS)
    }
    throw new NoticeError(failure)
  }
}

export const SESSION_MODE = 'auto'

/** What a chain session gets besides its name, model and prompt. */
export type SessionExtras = Pick<SessionStart, 'settings' | 'mcp' | 'plugins'> & {
  /** A file appended to the system prompt: the project's lone `AGENTS.md` (`agentsFallback`). */
  instructions?: string
}

/**
 * `Agent.write`: `claude -p` with the prompt on stdin — one read-only turn with no one to answer it, so no tool to ask,
 * edit or run anything (the changelog, BTN-209). `--tools` takes several values, so nothing but options follows it.
 */
export function writeArgs(model: string | null): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--tools',
    'Read,Glob,Grep',
    ...(model === null ? [] : ['--model', model]),
  ]
}

type ModelUsage = { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; costUSD?: number }

/**
 * The answer of `writeArgs`' turn and its cost; throws with the CLI's own words when the turn failed. The tokens come
 * from `modelUsage`, every call of the turn by model: the top `usage` counts only the last call.
 */
export function parseWriteAnswer(stdout: string): OneTurnAnswer {
  const answer = JSON.parse(stdout) as {
    subtype?: string
    is_error?: boolean
    result?: unknown
    duration_ms?: number
    total_cost_usd?: number
    modelUsage?: Record<string, ModelUsage>
  }
  if (answer.is_error === true || typeof answer.result !== 'string') {
    throw new Error(typeof answer.result === 'string' && answer.result !== '' ? answer.result : `the turn ended with ${answer.subtype ?? 'no result'}`)
  }
  const models = Object.entries(answer.modelUsage ?? {})
  const sum = (field: keyof ModelUsage) => models.reduce((total, [, usage]) => total + (usage[field] ?? 0), 0)
  const costliest = models.reduce<[string, ModelUsage] | null>((best, each) => (best === null || (each[1].costUSD ?? 0) > (best[1].costUSD ?? 0) ? each : best), null)
  return {
    text: answer.result,
    spend: {
      model: costliest?.[0] ?? null,
      tokens: { input: sum('inputTokens'), output: sum('outputTokens'), cacheRead: sum('cacheReadInputTokens'), cacheWrite: sum('cacheCreationInputTokens') },
      cost: typeof answer.total_cost_usd === 'number' ? answer.total_cost_usd : null,
      durationMs: answer.duration_ms ?? 0,
    },
  }
}

/**
 * `--mcp-config` takes several values, so it goes first, closed by `--strict-mcp-config`: right before the prompt it
 * would swallow it. A server goes under its `gatewayName`.
 */
export function sessionArgs(task: string, model: string | null, extras: SessionExtras = {}): string[] {
  const { settings, instructions } = extras
  return [
    '--bg',
    ...packageArgs(extras),
    '--permission-mode',
    SESSION_MODE,
    '-n',
    task,
    ...(model === null ? [] : ['--model', model]),
    ...(settings === undefined ? [] : ['--settings', settings]),
    ...(instructions === undefined ? [] : ['--append-system-prompt-file', instructions]),
  ]
}

function packageArgs({ mcp, plugins = [] }: SessionExtras): string[] {
  const servers = Object.fromEntries((mcp ?? []).map((each) => [gatewayName(each), { type: 'http', url: each.url }]))
  return [
    ...(mcp === undefined ? [] : ['--mcp-config', JSON.stringify({ mcpServers: servers }), '--strict-mcp-config']),
    ...plugins.flatMap(({ dir }) => ['--plugin-dir', dir]),
  ]
}

/** The permission mode of a keep-warm fork: whatever is not allowed already is refused, with nobody asked. */
export const WARM_MODE = 'dontAsk'

/**
 * The keep-warm ping (BTN-437): a fork of the session with no transcript, for one call, with the prompt on stdin. Its
 * tools, system prompt and model must be the session's, or it misses the cache: the session's servers, plugins,
 * settings and instructions, and the model of its last answer. `--max-turns 1` does not keep a tool call from running,
 * so the mode refuses one; the hooks are off, so that the plugins' hooks take no mail and hold no stop of the fork.
 * `plan` would be safer, but it changes the prompt and the fork read nothing (CLI 2.1.310, 2026-10-26).
 */
export function warmArgs(sessionId: string, model: string | null, extras: SessionExtras = {}): string[] {
  const { settings, instructions } = extras
  return [
    '-p',
    '--resume',
    sessionId,
    '--fork-session',
    '--no-session-persistence',
    '--output-format',
    'json',
    '--max-turns',
    '1',
    ...packageArgs(extras),
    '--permission-mode',
    WARM_MODE,
    ...(model === null ? [] : ['--model', model]),
    '--settings',
    hooksOff(settings),
    ...(instructions === undefined ? [] : ['--append-system-prompt-file', instructions]),
  ]
}

/** The chain's `--settings` JSON with every hook off: `disableAllHooks` does not change the prompt, so the cache holds. */
export function hooksOff(settings: string | undefined): string {
  return JSON.stringify({ ...(settings === undefined ? {} : (JSON.parse(settings) as object)), disableAllHooks: true })
}

/**
 * What the ping's one call read and wrote: the top `usage` of the result. A fork's `modelUsage` and `total_cost_usd`
 * carry on from the totals its transcript saved, so they count the session's earlier turns too, and the cost is left out.
 */
export function parseWarmAnswer(stdout: string, model: string | null): TurnSpend {
  return warmSpend(JSON.parse(stdout) as WarmResult, model)
}

/** The CLI's `result` message, as `-p --output-format json` prints it and the SDK streams it. */
export interface WarmResult {
  subtype?: string
  is_error?: boolean
  result?: unknown
  errors?: string[]
  duration_ms?: number
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
}

export function warmSpend(answer: WarmResult, model: string | null): TurnSpend {
  if (answer.is_error === true || answer.subtype !== 'success') {
    const detail = [typeof answer.result === 'string' ? answer.result : '', ...(answer.errors ?? [])].filter(Boolean).join('; ')
    throw new Error(detail || `the turn ended with ${answer.subtype ?? 'no result'}`)
  }
  const usage = answer.usage ?? {}
  return {
    model,
    tokens: {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
    },
    cost: null,
    durationMs: answer.duration_ms ?? 0,
  }
}

/**
 * A background session whose job is saved keeps its own options (model, mode, name, settings): with any flag
 * `--bg --resume` starts a copy under a new session id instead of going on in it (CLI 2.1.302, reason `own-options`).
 */
export function resumeArgs(sessionId: string, prompt: string, kept: boolean, task: string, model: string | null, extras: SessionExtras = {}): string[] {
  return [...(kept ? ['--bg'] : sessionArgs(task, model, extras)), '--resume', sessionId, promptArg(prompt)]
}

/**
 * A prompt as the CLI's last argument. The process the daemon spawns for a job reads one that starts with a dash as an
 * unknown option and exits before init (CLI 2.1.302, a reply's `- "question" → answer` line), so it gets a line break first.
 */
export function promptArg(prompt: string): string {
  return prompt.startsWith('-') ? `\n${prompt}` : prompt
}

function launchedAs(task: string, cwd: string, since: number): (agent: AgentEntry) => boolean {
  return (agent) => agent.name === task && samePath(agent.cwd, cwd) && agent.startedAt >= since - CLOCK_SKEW_MS
}

/**
 * A `--bg --resume` session may come up as a copy under a new session id and job (CLI 2.1.296), so a new job is also
 * recognised the way a launch is. The resumed job itself is taken only under its own session id: its respawned
 * process first shows a fresh id for under a second, until it loads the session (CLI 2.1.302).
 */
export function resumedAs(agentId: string, sessionId: string, task: string, cwd: string, since: number): (agent: AgentEntry) => boolean {
  const launched = launchedAs(task, cwd, since)
  return (agent) => !isOver(agent) && (agent.sessionId === sessionId || (agent.id !== agentId && launched(agent)))
}

function isOver(agent: AgentEntry): boolean {
  return agent.state === 'stopped' || agent.state === 'done' || agent.state === 'failed'
}

/** `failed` and `stopped` do not mean the process exited: a session that failed at start keeps running, and so does one stopped through a daemon that `claude stop` could not reach. */
function isGone(agent: AgentEntry | undefined): boolean {
  return agent === undefined || (isOver(agent) && agent.pid === undefined)
}

export async function liveRecords(home: AccountHome): Promise<SessionRecord[]> {
  const dir = join(home.dir, 'sessions')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const texts = await Promise.all(
    names.filter((name) => /^\d+\.json$/.test(name)).map((name) => readFile(join(dir, name), 'utf8').catch(() => '')),
  )
  const records = texts.map(parseSessionRecord).filter((record): record is SessionRecord => record !== undefined)
  const alive = await Promise.all(records.map((record) => sessionProcessAlive(record.pid, record.startedAt)))
  return records.filter((_, index) => alive[index])
}

/**
 * What only the job file of a session tells. A blocked session without a live `sessions/<pid>.json` has not begun
 * its first turn: it hangs on a startup dialog, and `claude agents` shows it only as `blocked`, like one with a question.
 * A live session that waits has its open `AskUserQuestion` there and not yet in the transcript, and every live one
 * the model it was started with.
 */
async function withJobFiles(home: AccountHome, agents: AgentEntry[]): Promise<AgentEntry[]> {
  return Promise.all(
    agents.map(async (agent) => {
      const { id } = agent
      const dialog = agent.state === 'blocked' && agent.pid === undefined
      if (id === undefined || !(dialog || agent.pid !== undefined)) return agent
      const job = await readFile(join(home.dir, 'jobs', id, 'state.json'), 'utf8').catch(() => undefined)
      if (dialog) {
        const needs = blockedOn(job)
        return needs === null ? agent : { ...agent, startupDialog: needs }
      }
      const model = launchedModel(job)
      const settings = launchedSettings(job)
      const ask = agent.status === 'waiting' ? blockedAsk(job, id) : null
      return { ...agent, ...(model !== null && { model }), ...(settings !== null && { settings }), ...(ask !== null && { ask }) }
    }),
  )
}

/** A failed `execFile` in a line: how it ended and what the CLI printed, without the command line `message` starts with. */
export function callFailure(error: unknown): string {
  if (error instanceof CallTimeout) return 'timed out'
  const { code, killed } = error as { code?: unknown; killed?: boolean }
  const ended = killed === true ? 'timed out' : typeof code === 'number' ? `exit code ${code}` : undefined
  if (ended === undefined) return error instanceof Error ? error.message : String(error)
  return [ended, outputOf(error)].filter(Boolean).join(' / ')
}

function outputOf(error: unknown): string {
  const { stdout, stderr } = error as { stdout?: string; stderr?: string }
  return [stderr, stdout].map((text) => text?.trim()).filter(Boolean).join(' / ')
}
