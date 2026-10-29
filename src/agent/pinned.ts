import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { DownloadProgress } from './download.js'

export interface PinnedCliOptions {
  /** The agent's folder of versions: `state/cli/<agent>`, a folder per version in it. */
  dir: string
  version: string
  /** The binary in a version's folder. */
  binary: (folder: string) => string
  /** Puts the version's files into an empty folder; throws on a failed download or a wrong checksum. */
  fetch: (into: string, progress?: DownloadProgress) => Promise<void>
  log: (line: string) => void
  /** The version is downloaded: the binary the agent resolves changed. */
  onReady: () => void
  onChange?: () => void
  onFailure?: () => Promise<void> | void
}

const PARTIAL = '.partial'

/**
 * Even Keel's own copy of the CLI version it was checked against (BTN-250): a folder per version, never the native
 * installer's `versions/`, whose binaries start the daemon through the shared launcher. A new folder for each version,
 * since a running exe cannot be replaced on Windows; locked old folders are retried on each version sweep.
 */
export class PinnedCli {
  private ready = false
  private running: Promise<void> | undefined
  progress = { received: 0, total: 0 }
  error = false
  get downloading(): boolean { return this.running !== undefined }

  constructor(private readonly options: PinnedCliOptions) {}

  /** Resolving a binary never grants permission to download it. */
  path(): string | undefined {
    const binary = this.options.binary(this.folder())
    if (this.ready || existsSync(binary)) {
      this.ready = true
      return binary
    }
    return undefined
  }

  ensure(): Promise<void> {
    if (this.path() !== undefined) return Promise.resolve()
    this.running ??= this.download().finally(() => {
      this.running = undefined
      this.options.onChange?.()
    })
    return this.running
  }

  private folder(): string {
    return join(this.options.dir, this.options.version)
  }

  private async download(): Promise<void> {
    const { dir, version, log } = this.options
    const partial = `${this.folder()}${PARTIAL}`
    this.error = false
    this.progress = { received: 0, total: 0 }
    try {
      await rm(partial, { recursive: true, force: true })
      await mkdir(partial, { recursive: true })
      log(`agents: downloading ${version} into ${dir}`)
      await this.options.fetch(partial, (received, total) => {
        this.progress = { received, total }
        this.options.onChange?.()
      })
      if (!existsSync(this.options.binary(partial))) throw new Error('download has no binary')
      await rename(partial, this.folder())
    } catch (error) {
      this.error = true
      await rm(partial, { recursive: true, force: true }).catch(() => {})
      log(`agents: could not download ${version} into ${dir}: ${error instanceof Error ? error.message : String(error)}`)
      await this.options.onFailure?.()
      return
    }
    this.ready = true
    log(`agents: ${version} is in ${this.folder()}`)
    await this.prune()
    this.options.onReady()
  }

  /** Retry locked folders on every version sweep, including at startup. */
  async prune(): Promise<void> {
    const { dir, version } = this.options
    for (const name of await readdir(dir).catch(() => [])) {
      if (name !== version && !(this.downloading && name === `${version}${PARTIAL}`)) {
        await rm(join(dir, name), { recursive: true, force: true }).catch(() => {})
      }
    }
  }
}
