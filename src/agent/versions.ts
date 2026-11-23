import type { OutdatedDaemon } from '../account/daemon.js'
import { englishOf, notice } from '../notice/notice.js'
import type { CliVersionView } from '../state.js'

/** What the watcher needs of an agent: its CLI's checked version and a way to ask the installed one. */
export interface VersionedAgent {
  name: string
  title: string
  checked: string
  installed(): boolean
  prune?(): Promise<void>
  /** Whether sessions run on the installed CLI: its provider is in use and not on Even Keel's copy (BTN-593). */
  runsOnInstalled?(): boolean
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
/** How often `noticeInstalls` looks whether a CLI appeared or went. */
export const INSTALLS_POLL_MS = 60_000

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
  /** By agent, whether its CLI was found at the last sweep: `noticeInstalls` compares with it. */
  private readonly found = new Map<string, boolean>()
  private running: Promise<void> | undefined
  private queued: Promise<void> | undefined

  constructor(private readonly options: VersionWatcherOptions) {}

  start(): void {
    void this.check()
    setInterval(() => void this.check(), this.options.intervalMs).unref()
    setInterval(() => void this.noticeInstalls(), INSTALLS_POLL_MS).unref()
  }

  /**
   * A sweep. Asked during one, it waits for one more that starts after it: a CLI installed or downloaded meanwhile is
   * read by the time it answers (BTN-1502).
   */
  check(): Promise<void> {
    if (this.running === undefined) {
      this.running = this.sweep().finally(() => { this.running = undefined })
      return this.running
    }
    this.queued ??= this.running.then(() => {
      this.queued = undefined
      return this.check()
    })
    return this.queued
  }

  /**
   * A sweep when a CLI appeared or went since the last one (BTN-1502): one installed by hand or by the page's button
   * shows its version within a minute, not at the next interval. Looking costs no call of a CLI.
   */
  noticeInstalls(): Promise<void> {
    const moved = this.options.agents().some((agent) => this.found.has(agent.name) && this.found.get(agent.name) !== agent.installed())
    return moved ? this.check() : Promise.resolve()
  }

  private async sweep(): Promise<void> {
    let changed = false
    for (const agent of this.options.agents()) {
      await agent.prune?.()
      const present = agent.installed()
      this.found.set(agent.name, present)
      const version = present ? await this.ask(agent) : null
      if (version === undefined || version === (this.installed.get(agent.name) ?? null)) continue
      if (version === null) this.installed.delete(agent.name)
      else this.installed.set(agent.name, version)
      changed = true
      const view = this.viewOf(agent)
      if (view !== null) this.options.log(`agents: ${englishOf(view.notice)}`)
    }
    if (changed) this.options.onChange()
  }

  view(): CliVersionView[] {
    return this.options.agents().flatMap((agent) => this.viewOf(agent) ?? [])
  }

  /** The installed CLI's version as last read, whatever it runs; `null` — none installed or not read yet. */
  installedOf(name: string): string | null {
    return this.installed.get(name) ?? null
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

  private viewOf({ name, title, checked, runsOnInstalled }: VersionedAgent): CliVersionView | null {
    if (runsOnInstalled?.() === false) return null
    const installed = this.installed.get(name)
    if (installed === undefined || installed === checked) return null
    return { agent: name, account: null, installed, checked, notice: notice('agent.uncheckedVersion', { title, installed, checked }) }
  }
}

/** A daemon on another version than the pin (BTN-250): its folder's sessions run on `running` until it is restarted. */
export function outdatedDaemonView({ agent, account, running, wanted }: OutdatedDaemon, title: string): CliVersionView {
  return { agent, account, installed: running, checked: wanted, notice: notice('agent.daemonVersion', { title, account, running, wanted }) }
}
