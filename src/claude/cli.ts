import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { AccountHome } from '../account/homes.js'
import { parseAuthStatus, type AccountStatus } from '../account/model.js'
import { gatewayName, type OneTurn, type SessionStart } from '../agent/contract.js'
import { runWithInput } from '../agent/oneturn.js'
import { fail, notice, NoticeError, type Notice } from '../notice/notice.js'
import { samePath } from '../paths.js'
import { blockedAsk, blockedOn, parseAgents, parseSessionRecord, withLiveRecords, type AgentEntry, type SessionRecord } from '../sessions/agents.js'
import { newestExtensionBinary } from '../sessions/paths.js'
import { descendantsOf, isAlive, killLeftovers } from './tree.js'

const run = promisify(execFile)

const APPEAR_TIMEOUT_MS = 30_000
const APPEAR_POLL_MS = 250
const EXIT_POLL_MS = 100
const CLOCK_SKEW_MS = 5_000

export function resolveClaudeBinary(env: NodeJS.ProcessEnv): string {
  if (env.EVEN_KEEL_CLAUDE_BIN) return env.EVEN_KEEL_CLAUDE_BIN
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
export async function updateMarketplace(env: NodeJS.ProcessEnv, marketplace: string, timeoutMs: number): Promise<void> {
  await run(resolveClaudeBinary(env), ['plugin', 'marketplace', 'update', marketplace], { env, timeout: timeoutMs, windowsHide: true })
}

export class ClaudeCli {
  constructor(
    private readonly bin: () => string,
    private readonly timeoutMs: number,
    private readonly envOf: (home: AccountHome) => NodeJS.ProcessEnv,
  ) {}

  async agents(home: AccountHome): Promise<AgentEntry[]> {
    const { stdout } = await run(this.bin(), ['agents', '--json', '--all'], {
      env: this.envOf(home),
      timeout: this.timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
    return withJobFiles(home, withLiveRecords(parseAgents(stdout, home.key), await liveRecords(home)))
  }

  async authStatus(home: AccountHome): Promise<AccountStatus> {
    const options = { env: this.envOf(home), timeout: this.timeoutMs, windowsHide: true }
    const stdout = await run(this.bin(), ['auth', 'status', '--json'], options).then(
      (result) => result.stdout,
      (error: unknown) => {
        const output = (error as { stdout?: string }).stdout ?? ''
        if (output.trim() === '') throw error
        return output
      },
    )
    return parseAuthStatus(stdout)
  }

  async usage(home: AccountHome, cwd: string): Promise<string> {
    const { stdout } = await run(this.bin(), ['-p', '/usage', '--output-format', 'json', '--no-session-persistence'], {
      cwd,
      env: this.envOf(home),
      timeout: this.timeoutMs,
      windowsHide: true,
    })
    return stdout
  }

  async write(home: AccountHome, { cwd, prompt, model, timeoutMs }: OneTurn): Promise<string> {
    return parseWriteAnswer(await runWithInput(this.bin(), writeArgs(model), prompt, { cwd, env: this.envOf(home), timeoutMs }))
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
    const children = running.pid === undefined ? Promise.resolve([]) : descendantsOf(running.pid)
    if (process.platform !== 'win32') await children
    try {
      await run(this.bin(), ['stop', agentId], { env: this.envOf(home), timeout: this.timeoutMs, windowsHide: true })
    } catch (error) {
      throw fail('claude.stopFailed', { agent: agentId }, { detail: outputOf(error) }, { cause: error })
    }
    const deadline = Date.now() + APPEAR_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (isAlive(running.pid)) {
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
export type SessionExtras = Pick<SessionStart, 'settings' | 'mcp' | 'plugins'>

/** `Agent.write`: `claude -p` with the prompt on stdin. `--tools` takes several values, so nothing but options follows it. */
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

/** The answer of `writeArgs`' turn; throws with the CLI's own words when the turn failed. */
export function parseWriteAnswer(stdout: string): string {
  const answer = JSON.parse(stdout) as { subtype?: string; is_error?: boolean; result?: unknown }
  if (answer.is_error === true || typeof answer.result !== 'string') {
    throw new Error(typeof answer.result === 'string' && answer.result !== '' ? answer.result : `the turn ended with ${answer.subtype ?? 'no result'}`)
  }
  return answer.result
}

/**
 * `--mcp-config` takes several values, so it goes first, closed by `--strict-mcp-config`: right before the prompt it
 * would swallow it. A server goes under its `gatewayName`.
 */
export function sessionArgs(task: string, model: string | null, extras: SessionExtras = {}): string[] {
  const { settings, mcp, plugins = [] } = extras
  const servers = Object.fromEntries((mcp ?? []).map((each) => [gatewayName(each), { type: 'http', url: each.url }]))
  return [
    '--bg',
    ...(mcp === undefined ? [] : ['--mcp-config', JSON.stringify({ mcpServers: servers }), '--strict-mcp-config']),
    ...plugins.flatMap(({ dir }) => ['--plugin-dir', dir]),
    '--permission-mode',
    SESSION_MODE,
    '-n',
    task,
    ...(model === null ? [] : ['--model', model]),
    ...(settings === undefined ? [] : ['--settings', settings]),
  ]
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
  return texts.map(parseSessionRecord).filter((record): record is SessionRecord => record !== undefined && isAlive(record.pid))
}

/**
 * What only the job file of a session tells. A blocked session without a live `sessions/<pid>.json` has not begun
 * its first turn: it hangs on a startup dialog, and `claude agents` shows it only as `blocked`, like one with a question.
 * A live session that waits has its open `AskUserQuestion` there and not yet in the transcript.
 */
async function withJobFiles(home: AccountHome, agents: AgentEntry[]): Promise<AgentEntry[]> {
  return Promise.all(
    agents.map(async (agent) => {
      const { id } = agent
      const dialog = agent.state === 'blocked' && agent.pid === undefined
      if (id === undefined || !(dialog || (agent.pid !== undefined && agent.status === 'waiting'))) return agent
      const job = await readFile(join(home.dir, 'jobs', id, 'state.json'), 'utf8').catch(() => undefined)
      if (dialog) {
        const needs = blockedOn(job)
        return needs === null ? agent : { ...agent, startupDialog: needs }
      }
      const ask = blockedAsk(job, id)
      return ask === null ? agent : { ...agent, ask }
    }),
  )
}

function outputOf(error: unknown): string {
  const { stdout, stderr } = error as { stdout?: string; stderr?: string }
  return [stderr, stdout].map((text) => text?.trim()).filter(Boolean).join(' / ')
}
