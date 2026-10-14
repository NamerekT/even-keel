import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { releaseOf, repositoryOf, type Release } from './release.js'

/** The installed version and the GitHub repository of the checkout, from its `package.json`. */
export function installed(root: string): { version: string; repo: string | null } {
  const { version, repository } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown; repository?: unknown }
  return { version: typeof version === 'string' ? version : '0.0.0', repo: repositoryOf(repository) }
}

export interface UpdateWatcherOptions {
  /** `owner/name` on GitHub; `null` — `package.json` names none, nothing is asked. */
  repo: string | null
  current: string
  /** `updates.check` of the config, read live. */
  enabled: () => boolean
  intervalMs: number
  onChange: () => void
  log: (line: string) => void
  fetchImpl?: typeof fetch
}

const TIMEOUT_MS = 15_000

/**
 * Asks GitHub for the latest release at the start and once per interval, without a token: 60 requests an hour per
 * address. A failure is one line in the log and keeps what was known; with the check off it asks nothing at all.
 */
export class UpdateWatcher {
  latest: Release | null = null
  private checkedAt: number | undefined
  private running = false

  constructor(private readonly options: UpdateWatcherOptions) {}

  start(): void {
    if (this.options.repo === null) {
      this.options.log('updates: package.json names no GitHub repository, new releases are not checked')
      return
    }
    void this.tick()
    setInterval(() => void this.tick(), this.options.intervalMs).unref()
  }

  /** The config changed: a check turned off forgets the release, one turned on asks at once unless it asked within the interval. */
  configChanged(): void {
    if (this.options.repo === null) return
    if (!this.options.enabled()) {
      this.set(null)
      return
    }
    if (this.checkedAt === undefined || Date.now() - this.checkedAt >= this.options.intervalMs) void this.tick()
  }

  private async tick(): Promise<void> {
    const { repo, enabled } = this.options
    if (repo === null || !enabled() || this.running) return
    this.running = true
    this.checkedAt = Date.now()
    try {
      const release = await this.ask(repo)
      if (enabled()) this.set(release)
    } catch (error) {
      this.options.log(`updates: could not check the releases of ${repo} on GitHub: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.running = false
    }
  }

  private async ask(repo: string): Promise<Release | null> {
    const { fetchImpl = fetch, current } = this.options
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `even-keel/${current}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 404) throw new Error('404, no published release or the repository is private')
    if (response.status === 403 || response.status === 429) throw new Error(`${response.status}, the hourly limit of requests without a token is spent`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return releaseOf(await response.json(), repo)
  }

  private set(release: Release | null): void {
    if (JSON.stringify(release) === JSON.stringify(this.latest)) return
    this.latest = release
    if (release !== null) this.options.log(`updates: the latest release on GitHub is ${release.version}, installed ${this.options.current}`)
    this.options.onChange()
  }
}
