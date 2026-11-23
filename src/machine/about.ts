import { hostname, release } from 'node:os'
import { readGitSetup } from '../git/setup.js'
import type { Git } from '../git/types.js'
import type { MachineAbout } from '../link/protocol.js'
import { installedClis } from './cli-report.js'

export interface AboutSources {
  /** Even Keel's version on this machine. */
  evenKeel: string
  root: string | null
  /** The commit of the checkout Even Keel runs from; none for a package of npm. */
  commit?: string | null
  /** Even Keel runs in a container (`inContainer`). */
  container?: boolean
  git: Git
  home: string
  /**
   * By agent, the version of the CLI its sessions run on, `null` — none (`cliReport`). Without it each installed CLI is
   * asked, found as a launch finds it (`installedClis`).
   */
  clis?: () => Promise<Record<string, string | null>>
}

/**
 * What a machine tells the hub about itself (BTN-1242): enough for the hub's page to say what it can run before a
 * task goes there. A CLI that is missing or silent is `null`, never a failure of the report. Sent at each handshake;
 * the CLIs then follow live in the machine's panel (`AccountView.clis`, BTN-1502).
 */
export async function machineAbout(sources: AboutSources): Promise<MachineAbout> {
  const git = await readGitSetup(sources.git, sources.home, () => null, async () => null)
  const agents = await (sources.clis ?? installedClis)()
  return {
    host: hostname(),
    os: `${process.platform} ${release()}`,
    evenKeel: sources.evenKeel,
    node: process.versions.node,
    git: git.version,
    agents,
    gitUser: git.name !== null && git.email !== null,
    ...(git.name !== null && { gitName: git.name }),
    ...(git.email !== null && { gitEmail: git.email }),
    root: sources.root,
    ...(typeof sources.commit === 'string' && { commit: sources.commit }),
    ...(sources.container === true && { container: true as const }),
  }
}
