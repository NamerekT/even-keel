import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { parseAuthStatus, type ClaudeAccount } from '../account/model.js'
import { parseAgents, type AgentEntry } from './agents.js'
import { newestExtensionBinary } from './paths.js'

const run = promisify(execFile)

const APPEAR_TIMEOUT_MS = 30_000
const APPEAR_POLL_MS = 1_000
const CLOCK_SKEW_MS = 5_000

export function resolveClaudeBinary(env: NodeJS.ProcessEnv): string {
  if (env.BATON_CLAUDE_BIN) return env.BATON_CLAUDE_BIN
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

export function claudeConfigDir(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
}

export class ClaudeCli {
  constructor(
    private readonly bin: () => string,
    private readonly timeoutMs: number,
  ) {}

  async agents(): Promise<AgentEntry[]> {
    const { stdout } = await run(this.bin(), ['agents', '--json', '--all'], {
      timeout: this.timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
    return parseAgents(stdout)
  }

  async authStatus(): Promise<ClaudeAccount> {
    const stdout = await run(this.bin(), ['auth', 'status', '--json'], { timeout: this.timeoutMs, windowsHide: true }).then(
      (result) => result.stdout,
      (error: unknown) => {
        const output = (error as { stdout?: string }).stdout ?? ''
        if (output.trim() === '') throw error
        return output
      },
    )
    return parseAuthStatus(stdout)
  }

  authLogin(): ChildProcessWithoutNullStreams {
    return spawn(this.bin(), ['auth', 'login', '--claudeai'], { windowsHide: true, stdio: 'pipe' })
  }

  async launch(task: string, cwd: string): Promise<AgentEntry> {
    const launchedAt = Date.now()
    try {
      await run(this.bin(), ['--bg', '--permission-mode', 'auto', '-n', task, task], {
        cwd,
        timeout: this.timeoutMs,
        windowsHide: true,
      })
    } catch (error) {
      const { stdout, stderr } = error as { stdout?: string; stderr?: string }
      const output = [stderr, stdout].map((text) => text?.trim()).filter(Boolean).join(' / ')
      throw new Error(`claude: could not start ${task} in ${cwd}${output ? `: ${output}` : ''}`, { cause: error })
    }

    const deadline = Date.now() + APPEAR_TIMEOUT_MS
    while (Date.now() < deadline) {
      const started = (await this.agents()).find(
        (agent) => agent.name === task && samePath(agent.cwd, cwd) && agent.startedAt >= launchedAt - CLOCK_SKEW_MS,
      )
      if (started !== undefined) return started
      await delay(APPEAR_POLL_MS)
    }
    throw new Error(`claude: ${task} was started but did not show up in claude agents`)
  }
}

function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase()
}
