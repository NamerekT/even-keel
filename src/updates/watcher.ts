import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { releasesOf, repositoryOf, type ReleaseNote } from './release.js'

/** The package's name, the installed version and the GitHub repository of the checkout, from its `package.json`. */
export function installed(root: string): { name: string; version: string; repo: string | null } {
  const { name, version, repository } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown; repository?: unknown }
  return { name: typeof name === 'string' ? name : 'even-keel', version: typeof version === 'string' ? version : '0.0.0', repo: repositoryOf(repository) }
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
/** The releases asked for: the update window shows the notes of every one newer than the installed version. */
const PAGE = 30

/**
 * Asks GitHub for the releases at the start and once per interval, without a token: 60 requests an hour per
 * address. A failure is one line in the log and keeps what was known; with the check off it asks nothing at all.
 */
export class UpdateWatcher {
  /** Published releases, newest first. */
  releases: ReleaseNote[] = []
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
      this.set([])
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
      const releases = await this.ask(repo)
      if (enabled()) this.set(releases)
    } catch (error) {
      this.options.log(`updates: could not check the releases of ${repo} on GitHub: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.running = false
    }
  }

  private async ask(repo: string): Promise<ReleaseNote[]> {
    const { fetchImpl = fetch, current } = this.options
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases?per_page=${PAGE}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `even-keel/${current}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 404) throw new Error('404, no published release or the repository is private')
    if (response.status === 403 || response.status === 429) throw new Error(`${response.status}, the hourly limit of requests without a token is spent`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return releasesOf(await response.json(), repo)
  }

  private set(releases: ReleaseNote[]): void {
    if (JSON.stringify(releases) === JSON.stringify(this.releases)) return
    const latest = releases[0]
    if (latest !== undefined && latest.version !== this.releases[0]?.version) {
      this.options.log(`updates: the latest release on GitHub is ${latest.version}, installed ${this.options.current}`)
    }
    this.releases = releases
    this.options.onChange()
  }
}
