import { execFile } from 'node:child_process'
import { extname } from 'node:path'
import { promisify } from 'node:util'
import type { BinaryMachine } from '../agent/npm-global.js'
import { thisMachine } from '../agent/npm-global.js'
import { PROVIDERS } from '../agent/providers.js'
import { cliVersionOf, type VersionWatcher } from '../agent/versions.js'
import { resolveClaudeBinary } from '../claude/cli.js'
import { CLAUDE } from '../claude/name.js'
import { resolveCodexBinary } from '../codex/cli.js'
import { CODEX } from '../codex/name.js'
import { resolveCopilotBinary } from '../copilot/cli.js'
import { COPILOT } from '../copilot/name.js'
import { resolveOpenCodeBinary } from '../opencode/cli.js'
import { OPENCODE } from '../opencode/name.js'
import { binaryPath } from '../paths.js'

const run = promisify(execFile)
const VERSION_MS = 10_000

/** What the report reads of an agent (`Agent`): whether its sessions' CLI is found, and the copy's version they run on. */
export interface ReportedAgent {
  installed?(): boolean
  pinned?(): string | null
}

/**
 * By agent, the version of the CLI its sessions run on (BTN-1502), `null` — none found: Even Keel's copy's own version
 * while they run on one, else the installed CLI's as `VersionWatcher` last read it (`installedOf`), found where a
 * launch looks — `EVEN_KEEL_<AGENT>_BIN`, `~/.local/bin`, a global npm install — not on the PATH alone. Asks no CLI.
 */
export function cliReport(agents: Iterable<[string, ReportedAgent]>, installedOf: (agent: string) => string | null): Record<string, string | null> {
  return Object.fromEntries([...agents].map(([name, agent]) => [name, agent.installed?.() === false ? null : (agent.pinned?.() ?? installedOf(name))]))
}

/** `cliReport` after a fresh sweep of the installed CLIs, for a report sent at a handshake or the hub's own machine's page. */
export async function sweptClis(agents: Iterable<[string, ReportedAgent]>, versions: Pick<VersionWatcher, 'check' | 'installedOf'>): Promise<Record<string, string | null>> {
  await versions.check()
  return cliReport(agents, (name) => versions.installedOf(name))
}

/**
 * The installed CLI of a provider, as its launch finds it without Even Keel's copy; the bare name — none found there,
 * looked for on the PATH.
 */
export function systemBinary(provider: string, env: NodeJS.ProcessEnv, machine: BinaryMachine = thisMachine()): string {
  if (provider === CLAUDE) return resolveClaudeBinary(env, undefined, machine)
  if (provider === OPENCODE) return resolveOpenCodeBinary(env, undefined, machine)
  if (provider === CODEX) return resolveCodexBinary(env)
  if (provider === COPILOT) return resolveCopilotBinary(env, undefined, machine.platform, machine.arch)
  return provider
}

/** `<binary> --version`; a `.cmd` shim of npm on Windows goes through `cmd.exe`. `null` — no such binary, or no answer. */
async function versionOf(binary: string): Promise<string | null> {
  const file = binaryPath(binary, process.env, process.cwd())
  if (file === undefined) return null
  const shim = process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(file).toLowerCase())
  try {
    const { stdout } = shim
      ? await run('cmd.exe', ['/d', '/c', file, '--version'], { timeout: VERSION_MS, windowsHide: true })
      : await run(file, ['--version'], { timeout: VERSION_MS, windowsHide: true })
    return stdout
  } catch {
    return null
  }
}

/**
 * Each provider's installed CLI asked its version in turn, for a report made outside the service (`even-keel join`),
 * which has no agents: found as a launch finds it (`systemBinary`).
 */
export async function installedClis(env: NodeJS.ProcessEnv = process.env, version: (binary: string) => Promise<string | null> = versionOf): Promise<Record<string, string | null>> {
  const agents: Record<string, string | null> = {}
  for (const provider of PROVIDERS) {
    const printed = await version(systemBinary(provider, env))
    agents[provider] = printed === null ? null : cliVersionOf(printed)
  }
  return agents
}
