import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { AccountHome } from '../account/homes.js'
import { parseAuthStatus, type ClaudeAccount } from '../account/model.js'
import { fail, notice, NoticeError, type Notice } from '../notice/notice.js'
import { samePath } from '../paths.js'
import type { ModelAlias } from '../tracker/model.js'
import { blockedOn, parseAgents, parseSessionRecord, withLiveRecords, type AgentEntry, type SessionRecord } from './agents.js'
import { newestExtensionBinary } from './paths.js'

const run = promisify(execFile)

const APPEAR_TIMEOUT_MS = 30_000
const APPEAR_POLL_MS = 1_000
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
    return withStartupDialogs(home, withLiveRecords(parseAgents(stdout, home.key), await liveRecords(home)))
  }

  async authStatus(home: AccountHome): Promise<ClaudeAccount> {
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

  async launch(home: AccountHome, task: string, cwd: string, prompt: string, model: ModelAlias, settings?: string): Promise<AgentEntry> {
    const launchedAt = Date.now()
    await this.start(home, [...sessionArgs(task, model, settings), prompt], cwd, notice('claude.startFailed', { task, cwd }))
    return this.appear(home, launchedAs(task, cwd, launchedAt), notice('claude.notShown', { task }))
  }

  async resume(
    home: AccountHome,
    sessionId: string,
    task: string,
    cwd: string,
    prompt: string,
    model: ModelAlias,
    settings?: string,
  ): Promise<AgentEntry> {
    const resumedAt = Date.now()
    const args = [...sessionArgs(task, model, settings), '--resume', sessionId, prompt]
    await this.start(home, args, cwd, notice('claude.resumeFailed', { task, cwd }))
    return this.appear(home, resumedAs(sessionId, task, cwd, resumedAt), notice('claude.resumedNotShown', { task }))
  }

  async stop(home: AccountHome, agentId: string, sessionId: string): Promise<void> {
    const running = (await this.agents(home)).find((entry) => entry.sessionId === sessionId)
    if (running === undefined || isGone(running)) return
    try {
      await run(this.bin(), ['stop', agentId], { env: this.envOf(home), timeout: this.timeoutMs, windowsHide: true })
    } catch (error) {
      throw fail('claude.stopFailed', { agent: agentId }, { detail: outputOf(error) }, { cause: error })
    }
    const deadline = Date.now() + APPEAR_TIMEOUT_MS
    while (Date.now() < deadline) {
      const agent = (await this.agents(home)).find((entry) => entry.sessionId === sessionId)
      if (isGone(agent) && !isAlive(running.pid)) return
      await delay(APPEAR_POLL_MS)
    }
    throw fail('claude.stillRunning', { agent: agentId })
  }

  async stopDaemon(home: AccountHome): Promise<void> {
    if (home.global) throw fail('claude.globalDaemon', {})
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

export function sessionArgs(task: string, model: ModelAlias, settings?: string): string[] {
  return ['--bg', '--permission-mode', SESSION_MODE, '-n', task, '--model', model, ...(settings === undefined ? [] : ['--settings', settings])]
}

function launchedAs(task: string, cwd: string, since: number): (agent: AgentEntry) => boolean {
  return (agent) => agent.name === task && samePath(agent.cwd, cwd) && agent.startedAt >= since - CLOCK_SKEW_MS
}

/** A `--bg --resume` session may come up under a new session id (CLI 2.1.296), so it is also recognised the way a launch is. */
export function resumedAs(sessionId: string, task: string, cwd: string, since: number): (agent: AgentEntry) => boolean {
  const launched = launchedAs(task, cwd, since)
  return (agent) => !isOver(agent) && (agent.sessionId === sessionId || launched(agent))
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
 * A blocked session without a live `sessions/<pid>.json` has not begun its first turn: it hangs on a startup dialog.
 * `claude agents` shows it only as `blocked`, like one with a question; what it waits for is in its job file.
 */
async function withStartupDialogs(home: AccountHome, agents: AgentEntry[]): Promise<AgentEntry[]> {
  return Promise.all(
    agents.map(async (agent) => {
      if (agent.state !== 'blocked' || agent.pid !== undefined || agent.id === undefined) return agent
      const needs = blockedOn(await readFile(join(home.dir, 'jobs', agent.id, 'state.json'), 'utf8').catch(() => undefined))
      return needs === null ? agent : { ...agent, startupDialog: needs }
    }),
  )
}

function isAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false
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
