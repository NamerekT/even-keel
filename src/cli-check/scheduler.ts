import type { AccountHome } from '../account/homes.js'
import { englishOf, notice } from '../notice/notice.js'
import type { CliCheckView } from '../state.js'
import type { AccountLease } from './lease.js'

const POLL_MS = 6 * 60 * 60_000
const WEEK_MS = 7 * 24 * 60 * 60_000

export interface CheckAgent { name: string; title: string; checked: string; home: AccountHome }
export interface CheckResult { version: string; at: number; status: 'running' | 'passed' | 'failed'; detail?: string }
export interface AgentHistory {
  polled?: number
  latest?: string
  attempted: string[]
  weeklyAt?: number
  result?: CheckResult
}
export type CheckHistory = Record<string, AgentHistory>
export type CheckView = CliCheckView

export interface CliChecksOptions {
  enabled: () => boolean
  ready: () => boolean
  agents: () => CheckAgent[]
  latest: (agent: string) => Promise<string>
  live: (home: AccountHome) => Promise<boolean>
  run: (check: { agent: string; version: string; home: AccountHome }) => Promise<void>
  lease: AccountLease
  history: CheckHistory
  accountLabel: (home: AccountHome) => string
  save: (history: CheckHistory) => Promise<void>
  now: () => number
  changed: () => void
  log: (line: string) => void
}

export class CliChecks {
  private polling = false
  private stopped = false
  private readonly views = new Map<string, CheckView>()

  constructor(private readonly options: CliChecksOptions) {
    for (const history of Object.values(options.history)) {
      if (history.result?.status !== 'running') continue
      const { version } = history.result
      history.attempted = history.attempted.filter((each) => each !== version)
      delete history.weeklyAt
    }
  }

  stop(): void { this.stopped = true }

  view(): CheckView[] {
    if (!this.options.enabled()) return []
    return this.options.agents().flatMap(agent => {
      const view = this.views.get(agent.name)
      if (view) return [view]
      const result = this.options.history[agent.name]?.result
      return result === undefined ? [] : [this.resultView(agent, result)]
    })
  }

  async check(): Promise<void> {
    const o = this.options
    if (this.stopped || this.polling || !o.enabled() || !o.ready()) return
    this.polling = true
    try {
      for (const agent of o.agents()) {
        if (this.stopped || !o.enabled()) break
        const now = o.now()
        const history = o.history[agent.name] ??= { attempted: [] }
        if (history.polled === undefined || now - history.polled >= POLL_MS) {
          history.polled = now
          try { history.latest = await o.latest(agent.name) } catch (error) { o.log(`cli-check: ${agent.name}: version lookup failed: ${String(error)}`) }
          await o.save(o.history)
        }
        const latest = history.latest
        const fresh = latest !== undefined && newer(latest, agent.checked) && !history.attempted.includes(latest)
        const weekly = history.weeklyAt === undefined || now - history.weeklyAt >= WEEK_MS
        const version = fresh ? latest : weekly ? agent.checked : undefined
        if (version === undefined) continue
        const release = o.lease.reserve(agent.home)
        if (release === undefined) { this.wait(agent, version); continue }
        try {
          // Discovery errors keep the check waiting: an unreadable account is never proof that it is free.
          if (await o.live(agent.home)) { this.wait(agent, version); continue }
          if (this.stopped || !o.enabled()) break
          if (fresh) history.attempted.push(version)
          history.weeklyAt = now
          history.result = { version, at: now, status: 'running' }
          await o.save(o.history)
          this.show(agent.name, { agent: agent.name, at: now, notice: notice('cliCheck.running', { title: agent.title, version, account: o.accountLabel(agent.home) }) })
          try {
            await o.run({ agent: agent.name, version, home: agent.home })
            history.result = { version, at: o.now(), status: 'passed' }
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error)
            o.log(`cli-check: ${agent.name} ${version}: ${detail}`)
            history.result = { version, at: o.now(), status: 'failed', detail: detail.slice(0, 400) }
          }
          await o.save(o.history)
          this.show(agent.name, this.resultView(agent, history.result))
        } catch (error) {
          o.log(`cli-check: ${agent.name}: ${String(error)}`)
          this.wait(agent, version)
        } finally { release() }
      }
    } finally { this.polling = false }
  }

  private resultView(agent: CheckAgent, result: CheckResult): CheckView {
    const { version, at, status } = result
    const title = agent.title
    // A result left `running` is a check the service's stop cut short.
    return { agent: agent.name, at, notice: status === 'passed'
      ? notice('cliCheck.passed', { title, version })
      : status === 'running'
        ? notice('cliCheck.interrupted', { title, version })
        : notice('cliCheck.failed', { title, version }, result.detail === undefined ? {} : { detail: result.detail }) }
  }

  private wait(agent: CheckAgent, version: string): void {
    this.show(agent.name, { agent: agent.name, at: this.options.now(), notice: notice('cliCheck.waiting', { title: agent.title, version, account: this.options.accountLabel(agent.home) }) })
  }

  private show(name: string, view: CheckView): void {
    const before = this.views.get(name)
    if (JSON.stringify(before?.notice) === JSON.stringify(view.notice)) return
    this.views.set(name, view)
    this.options.log(`cli-check: ${englishOf(view.notice)}`)
    this.options.changed()
  }
}

export function newer(candidate: string, checked: string): boolean {
  const parts = (value: string) => value.split('.').map(Number)
  if (!/^\d+\.\d+\.\d+$/.test(candidate)) return false
  const left = parts(candidate), right = parts(checked.split('-')[0]!)
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index]! > right[index]!
  }
  return checked.includes('-')
}
