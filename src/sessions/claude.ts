import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { AccountHome } from '../account/homes.js'
import { parseAuthStatus, type ClaudeAccount } from '../account/model.js'
import { samePath } from '../paths.js'
import type { ModelAlias } from '../tracker/model.js'
import { parseAgents, parseSessionRecord, withLiveRecords, type AgentEntry, type SessionRecord } from './agents.js'
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
    return withLiveRecords(parseAgents(stdout, home.key), await liveRecords(home))
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
      throw new Error(`claude: could not sign out of ${home.key}${outputOf(error)}`, { cause: error })
    }
  }

  async launch(home: AccountHome, task: string, cwd: string, prompt: string, model: ModelAlias | null): Promise<AgentEntry> {
    const launchedAt = Date.now()
    await this.start(home, [...sessionArgs(task, model), prompt], cwd, `start ${task} in ${cwd}`)
    return this.appear(
      home,
      (agent) => agent.name === task && samePath(agent.cwd, cwd) && agent.startedAt >= launchedAt - CLOCK_SKEW_MS,
      `${task} was started but did not show up in claude agents`,
    )
  }

  async resume(
    home: AccountHome,
    sessionId: string,
    task: string,
    cwd: string,
    prompt: string,
    model: ModelAlias | null,
  ): Promise<AgentEntry> {
    const args = [...sessionArgs(task, model), '--resume', sessionId, prompt]
    await this.start(home, args, cwd, `resume ${task} in ${cwd}`)
    return this.appear(
      home,
      (agent) => agent.sessionId === sessionId && !isOver(agent),
      `${task} was resumed but did not show up in claude agents`,
    )
  }

  async stop(home: AccountHome, agentId: string, sessionId: string): Promise<void> {
    const running = (await this.agents(home)).find((entry) => entry.sessionId === sessionId)
    if (running === undefined || isGone(running)) return
    try {
      await run(this.bin(), ['stop', agentId], { env: this.envOf(home), timeout: this.timeoutMs, windowsHide: true })
    } catch (error) {
      throw new Error(`claude: could not stop ${agentId}${outputOf(error)}`, { cause: error })
    }
    const deadline = Date.now() + APPEAR_TIMEOUT_MS
    while (Date.now() < deadline) {
      const agent = (await this.agents(home)).find((entry) => entry.sessionId === sessionId)
      if (isGone(agent) && !isAlive(running.pid)) return
      await delay(APPEAR_POLL_MS)
    }
    throw new Error(`claude: ${agentId} was told to stop but is still running`)
  }

  async stopDaemon(home: AccountHome): Promise<void> {
    if (home.global) throw new Error('claude: the global daemon is not stopped from here')
    try {
      await run(this.bin(), ['daemon', 'stop', '--any'], { env: this.envOf(home), timeout: this.timeoutMs, windowsHide: true })
    } catch (error) {
      throw new Error(`claude: could not stop the daemon of ${home.key}${outputOf(error)}`, { cause: error })
    }
  }

  private async start(home: AccountHome, args: string[], cwd: string, what: string): Promise<void> {
    try {
      await run(this.bin(), args, { cwd, env: this.envOf(home), timeout: this.timeoutMs, windowsHide: true })
    } catch (error) {
      throw new Error(`claude: could not ${what}${outputOf(error)}`, { cause: error })
    }
  }

  private async appear(home: AccountHome, match: (agent: AgentEntry) => boolean, failure: string): Promise<AgentEntry> {
    const deadline = Date.now() + APPEAR_TIMEOUT_MS
    while (Date.now() < deadline) {
      const found = (await this.agents(home)).find(match)
      if (found !== undefined) return found
      await delay(APPEAR_POLL_MS)
    }
    throw new Error(`claude: ${failure}`)
  }
}

function sessionArgs(task: string, model: ModelAlias | null): string[] {
  return ['--bg', '--permission-mode', 'auto', '-n', task, ...(model === null ? [] : ['--model', model])]
}

function isOver(agent: AgentEntry): boolean {
  return agent.state === 'stopped' || agent.state === 'done' || agent.state === 'failed'
}

function isGone(agent: AgentEntry | undefined): boolean {
  if (agent === undefined || agent.state === 'stopped' || agent.state === 'failed') return true
  return agent.state === 'done' && agent.pid === undefined
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
  const output = [stderr, stdout].map((text) => text?.trim()).filter(Boolean).join(' / ')
  return output ? `: ${output}` : ''
}
