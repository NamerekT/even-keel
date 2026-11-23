import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentOptions } from './contract.js'
import type { DownloadProgress } from './download.js'
import { PinnedCli, type PinnedCliOptions } from './pinned.js'

export interface LatestCliOptions extends Omit<PinnedCliOptions, 'version' | 'fetch'> {
  /** The newest released version, as the agent's `latest` asks its registry. */
  latest: () => Promise<string>
  fetch: (version: string, into: string, progress?: DownloadProgress) => Promise<void>
}

const PARTIAL = '.partial'
const NO_PROGRESS = { received: 0, total: 0 }

/**
 * Even Keel's own copy of the newest released CLI (`cli: latest`, BTN-1539), for a machine where a person cannot install
 * the CLI themselves: a container, a global npm folder it cannot write. A folder per version as `PinnedCli` keeps,
 * in a folder of its own: the version is the newest whole folder on disk, so nothing is stored besides the files.
 * Each `ensure` asks the registry and downloads a newer version beside the one sessions run on; until it is whole the
 * copy stays ready on the old one, and a failed registry call or download keeps it quietly.
 */
export class LatestCli {
  private current: PinnedCli | undefined
  private currentVersion: string | null = null
  private next: PinnedCli | undefined
  private running: Promise<void> | undefined
  private failed = false

  constructor(private readonly options: LatestCliOptions) {
    const version = newestIn(options.dir, options.binary)
    if (version !== null) this.take(version, this.pinned(version))
  }

  path(): string | undefined {
    return this.current?.path()
  }

  /** The version sessions run on, `null` — none is downloaded. */
  version(): string | null {
    return this.path() === undefined ? null : this.currentVersion
  }

  /** Only the first download: a newer version downloading beside a ready one is no wait for anybody. */
  get downloading(): boolean { return this.running !== undefined && this.path() === undefined }
  get error(): boolean { return this.failed && this.path() === undefined }
  get progress(): { received: number; total: number } { return this.next?.progress ?? NO_PROGRESS }

  hadCopy(): boolean {
    return newestIn(this.options.dir, this.options.binary) !== null
  }

  ensure(): Promise<void> {
    this.running ??= this.update().finally(() => {
      this.running = undefined
      this.options.onChange?.()
    })
    return this.running
  }

  /** The sweep of `PinnedCli`, skipped while a download runs: the old version's sweep would remove the new one's folder. */
  async prune(): Promise<void> {
    if (this.running === undefined) await this.current?.prune()
  }

  private async update(): Promise<void> {
    const { dir, log } = this.options
    this.failed = false
    let version: string
    try {
      version = await this.options.latest()
    } catch (error) {
      log(`agents: could not read the newest version for ${dir}: ${error instanceof Error ? error.message : String(error)}`)
      return this.fail()
    }
    if (version === this.currentVersion && this.path() !== undefined) return
    const next = this.pinned(version)
    this.next = next
    try {
      await next.ensure()
    } finally {
      this.next = undefined
    }
    if (next.path() === undefined) return this.fail()
    this.take(version, next)
    this.options.onReady()
  }

  private take(version: string, copy: PinnedCli): void {
    this.current = copy
    this.currentVersion = version
  }

  private async fail(): Promise<void> {
    this.failed = true
    if (this.path() === undefined) await this.options.onFailure?.()
  }

  /** Readiness and failure are this class's: the version's copy only downloads and sweeps. */
  private pinned(version: string): PinnedCli {
    const { dir, binary, fetch, log, onChange } = this.options
    return new PinnedCli({ dir, version, binary, fetch: (into, progress) => fetch(version, into, progress), log, onReady: () => {}, onChange })
  }
}

/** An agent's copy of the newest release in `state/cli/<agent>-latest`, beside the checked one's `state/cli/<agent>`. */
export function latestCopyOf(
  { workDir, log, onCliChange, onCliProgress, onCliFailure }: Pick<AgentOptions, 'workDir' | 'log' | 'onCliChange' | 'onCliProgress' | 'onCliFailure'>,
  agent: string,
  copy: Pick<LatestCliOptions, 'latest' | 'binary' | 'fetch'>,
): LatestCli {
  return new LatestCli({ dir: join(workDir, 'cli', `${agent}-latest`), ...copy, log, onReady: onCliChange, onChange: onCliProgress ?? onCliChange, onFailure: onCliFailure })
}

/** The newest version folder of `dir` that holds its binary; unfinished downloads aside. */
function newestIn(dir: string, binary: (folder: string) => string): string | null {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const versions = entries
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith(PARTIAL) && existsSync(binary(join(dir, entry.name))))
    .map((entry) => entry.name)
    .sort(compareVersions)
  return versions.at(-1) ?? null
}

/** Dotted versions by their numbers; a pre-release comes before its release. */
export function compareVersions(a: string, b: string): number {
  const [mainA = '', preA] = a.split('-', 2)
  const [mainB = '', preB] = b.split('-', 2)
  const partsA = mainA.split('.').map(Number)
  const partsB = mainB.split('.').map(Number)
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0)
    if (Number.isNaN(diff)) return a.localeCompare(b)
    if (diff !== 0) return diff
  }
  if (preA === undefined || preB === undefined) return preA === undefined ? (preB === undefined ? 0 : 1) : -1
  return preA.localeCompare(preB)
}
