import { englishOf, notice } from '../notice/notice.js'
import type { CliVersionView } from '../state.js'

/** What the watcher needs of an agent: its CLI's checked version and a way to ask the installed one. */
export interface VersionedAgent {
  name: string
  title: string
  checked: string
  installed(): boolean
  /** What `<cli> --version` prints. */
  version(): Promise<string>
}

export interface VersionWatcherOptions {
  agents: () => VersionedAgent[]
  intervalMs: number
  onChange: () => void
  log: (line: string) => void
}

const VERSION = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/

/** The version in the output of `claude --version` (`2.1.303 (Claude Code)`) or `codex --version` (`codex-cli 0.162.1`). */
export function cliVersionOf(output: string): string | null {
  return VERSION.exec(output)?.[0] ?? null
}

/**
 * Asks each installed CLI its version at the start and once per interval: both CLIs update themselves while the
 * service runs. A failed call is one line in the log and keeps what was known; the chain is never held by it.
 */
export class VersionWatcher {
  private readonly installed = new Map<string, string>()
  private readonly failures = new Map<string, string>()
  private running = false

  constructor(private readonly options: VersionWatcherOptions) {}

  start(): void {
    void this.check()
    setInterval(() => void this.check(), this.options.intervalMs).unref()
  }

  async check(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      let changed = false
      for (const agent of this.options.agents()) {
        const version = agent.installed() ? await this.ask(agent) : null
        if (version === undefined || version === (this.installed.get(agent.name) ?? null)) continue
        if (version === null) this.installed.delete(agent.name)
        else this.installed.set(agent.name, version)
        changed = true
        const view = this.viewOf(agent)
        if (view !== null) this.options.log(`agents: ${englishOf(view.notice)}`)
      }
      if (changed) this.options.onChange()
    } finally {
      this.running = false
    }
  }

  view(): CliVersionView[] {
    return this.options.agents().flatMap((agent) => this.viewOf(agent) ?? [])
  }

  /** `undefined` — the call failed, what was known stays. */
  private async ask(agent: VersionedAgent): Promise<string | undefined> {
    let failure: string
    try {
      const output = await agent.version()
      const version = cliVersionOf(output)
      if (version !== null) {
        this.failures.delete(agent.name)
        return version
      }
      failure = `no version in ${JSON.stringify(output.trim())}`
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    if (this.failures.get(agent.name) !== failure) this.options.log(`agents: could not read the version of ${agent.title}: ${failure}`)
    this.failures.set(agent.name, failure)
    return undefined
  }

  private viewOf({ name, title, checked }: VersionedAgent): CliVersionView | null {
    const installed = this.installed.get(name)
    if (installed === undefined || installed === checked) return null
    return { agent: name, installed, checked, notice: notice('agent.uncheckedVersion', { title, installed, checked }) }
  }
}
