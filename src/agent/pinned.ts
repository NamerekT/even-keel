import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface PinnedCliOptions {
  /** The agent's folder of versions: `state/cli/<agent>`, a folder per version in it. */
  dir: string
  version: string
  /** The binary in a version's folder. */
  binary: (folder: string) => string
  /** Puts the version's files into an empty folder; throws on a failed download or a wrong checksum. */
  fetch: (into: string) => Promise<void>
  log: (line: string) => void
  /** The version is downloaded: the binary the agent resolves changed. */
  onReady: () => void
  /** How long a failed download waits before the next try. */
  retryMs: number
  now?: () => number
}

const PARTIAL = '.partial'
/** A failed download is tried again this much later, or on the next service start. */
export const PIN_RETRY_MS = 15 * 60_000

/**
 * Even Keel's own copy of the CLI version it was checked against (BTN-250): a folder per version, never the native
 * installer's `versions/`, whose binaries start the daemon through the shared launcher. A new folder for each version,
 * since a running exe cannot be replaced on Windows; the previous version stays for the sessions still on it.
 */
export class PinnedCli {
  private ready = false
  private running: Promise<void> | undefined
  private failedAt: number | undefined

  constructor(private readonly options: PinnedCliOptions) {}

  /** The binary, once downloaded; until then `undefined`, and the download starts. */
  path(): string | undefined {
    const binary = this.options.binary(this.folder())
    if (this.ready || existsSync(binary)) {
      this.ready = true
      return binary
    }
    void this.ensure()
    return undefined
  }

  ensure(): Promise<void> {
    if (this.ready) return Promise.resolve()
    const now = (this.options.now ?? Date.now)()
    if (this.failedAt !== undefined && now - this.failedAt < this.options.retryMs) return Promise.resolve()
    this.running ??= this.download().finally(() => (this.running = undefined))
    return this.running
  }

  private folder(): string {
    return join(this.options.dir, this.options.version)
  }

  private async download(): Promise<void> {
    const { dir, version, log } = this.options
    const partial = `${this.folder()}${PARTIAL}`
    try {
      await rm(partial, { recursive: true, force: true })
      await mkdir(partial, { recursive: true })
      log(`agents: downloading ${version} into ${dir}`)
      await this.options.fetch(partial)
      await rename(partial, this.folder())
    } catch (error) {
      this.failedAt = (this.options.now ?? Date.now)()
      await rm(partial, { recursive: true, force: true }).catch(() => {})
      log(`agents: could not download ${version} into ${dir}: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    this.ready = true
    this.failedAt = undefined
    log(`agents: ${version} is in ${this.folder()}`)
    await this.prune()
    this.options.onReady()
  }

  /** Keeps this version and the newest other one; a folder still in use stays until the next download. */
  private async prune(): Promise<void> {
    const { dir, version } = this.options
    const others = await Promise.all(
      (await readdir(dir)).filter((name) => name !== version).map(async (name) => ({ name, at: (await stat(join(dir, name))).mtimeMs })),
    )
    const finished = others.filter(({ name }) => !name.endsWith(PARTIAL)).sort((a, b) => b.at - a.at)
    const kept = finished[0]?.name
    for (const { name } of others) {
      if (name !== kept) await rm(join(dir, name), { recursive: true, force: true }).catch(() => {})
    }
  }
}
