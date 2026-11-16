import { execFile } from 'node:child_process'
import { hostname, release } from 'node:os'
import { extname } from 'node:path'
import { promisify } from 'node:util'
import { PROVIDERS } from '../agent/providers.js'
import { cliVersionOf } from '../agent/versions.js'
import { readGitSetup } from '../git/setup.js'
import type { Git } from '../git/types.js'
import type { MachineAbout } from '../link/protocol.js'
import { binaryPath } from '../paths.js'

const run = promisify(execFile)
const VERSION_MS = 10_000

export interface AboutSources {
  /** Even Keel's version on this machine. */
  evenKeel: string
  root: string | null
  git: Git
  home: string
  /** What `<binary> --version` prints; `null` — no such binary or it did not answer. */
  version?: (binary: string) => Promise<string | null>
}

/** `<binary> --version` from the PATH; a `.cmd` shim of npm on Windows goes through `cmd.exe`. */
async function versionOnPath(binary: string): Promise<string | null> {
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
 * What a machine tells the hub about itself (BTN-1242): enough for the hub's page to say what it can run before a
 * task goes there. Each CLI is asked in turn; one that is missing or silent is `null`, never a failure of the report.
 */
export async function machineAbout(sources: AboutSources): Promise<MachineAbout> {
  const version = sources.version ?? versionOnPath
  const git = await readGitSetup(sources.git, sources.home, () => null, async () => null)
  const agents: Record<string, string | null> = {}
  for (const agent of PROVIDERS) {
    const printed = await version(agent)
    agents[agent] = printed === null ? null : cliVersionOf(printed)
  }
  return {
    host: hostname(),
    os: `${process.platform} ${release()}`,
    evenKeel: sources.evenKeel,
    node: process.versions.node,
    git: git.version,
    agents,
    gitUser: git.name !== null && git.email !== null,
    root: sources.root,
  }
}
