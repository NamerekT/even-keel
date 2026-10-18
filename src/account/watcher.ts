import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Agent } from '../agent/contract.js'
import { CODEX } from '../codex/name.js'
import type { RateLimits } from '../limits/model.js'
import type { UsageHealth } from '../limits/usage.js'
import { fail, notice, NoticeError, noticeOf, sameNotice, type Notice } from '../notice/notice.js'
import { appSwitchProblem, type AppAccount, type AppId } from './apps.js'
import { assertApiKey, type AccountHome, type AccountHomes } from './homes.js'
import { CreditChecks, type CreditVerdict } from './credit.js'
import { KeyChecks, type KeyVerdict } from './keycheck.js'
import {
  cleanOutput,
  isApiKey,
  loginBlockNotice,
  loginUrls,
  needsLogin,
  removeProblem,
  secondFreeProblem,
  switchProblem,
  withIdentity,
  type AccountEntry,
  type AccountLogin,
  type AccountView,
  type AccountStatus,
  type LoginBlock,
  type PoolEntry,
} from './model.js'

const MAX_OUTPUT_CHARS = 16 * 1024
const SHOWN_OUTPUT_CHARS = 2 * 1024

export type AccountAgent = Pick<Agent, 'authStatus' | 'login' | 'logout'>

export interface AppControl {
  list: () => AppAccount[]
  refresh: () => Promise<void>
  point: (app: AppId, home: AccountHome) => void
}

export interface AccountWatcherOptions {
  homes: AccountHomes
  /** The agent whose account folder it is, by `AccountHome.agent`. */
  agentOf: (home: AccountHome) => AccountAgent
  apps: AppControl
  prepare: (home: AccountHome) => Promise<void>
  active: () => string
  activate: (key: string) => void
  forget: (key: string) => void
  nameOf: (key: string) => string | null
  name: (key: string, name: string) => void
  loginBlock: () => LoginBlock | null
  sessionsIn: (key: string) => string[]
  /** The projects whose sessions run in the folder, by the pool. */
  projectsOn: (key: string) => string[]
  pool: () => PoolEntry[]
  sessionsKnown: () => boolean
  removing: (key: string) => boolean
  markRemoving: (key: string, on: boolean) => void
  configPending: (key: string) => boolean
  limits: (key: string) => RateLimits | null
  usage: (key: string) => UsageHealth
  /** Whether the agent's provider takes the key. */
  checkKey: (agent: string, key: string) => Promise<KeyVerdict>
  keyCheckMs: number
  /** Whether the key can pay again, asked of the agent's provider. */
  checkCredit: (agent: string, key: string) => Promise<CreditVerdict>
  creditCheckMs: number
  intervalMs: number
  loginTimeoutMs: number
  now: () => Date
  onChange: () => void
  onError: (error: unknown) => void
}

interface Known {
  home: AccountHome
  status: AccountStatus | null
  error: Notice | null
}

interface Running {
  child: ChildProcessWithoutNullStreams
  home: AccountHome
  adding: boolean
}

export class AccountWatcher {
  private known: Known[] = []
  private current: AccountLogin | null = null
  private running: Running | undefined
  private output = ''
  private timer: NodeJS.Timeout | undefined
  private readonly keys: KeyChecks
  private readonly credit: CreditChecks

  constructor(private readonly options: AccountWatcherOptions) {
    this.keys = new KeyChecks(options.keyCheckMs)
    this.credit = new CreditChecks(options.creditCheckMs)
  }

  get view(): AccountView {
    const now = this.options.now()
    const accounts = this.known.map(({ home, status, error }): AccountEntry => {
      const times = this.options.homes.times(home)
      return {
        key: home.key,
        name: this.options.nameOf(home.key),
        global: home.global,
        agent: home.agent,
        status,
        error,
        loginExpiresAt: times.loginExpiresAt === null || times.erased ? null : new Date(times.loginExpiresAt).toISOString(),
        needsLogin: needsLogin(status, times, now) || (isApiKey(status) && this.keys.rejected(home.key)),
        sessions: this.options.sessionsIn(home.key),
        projects: this.options.projectsOn(home.key),
        removing: this.options.removing(home.key),
        configPending: this.options.configPending(home.key),
        apiKey: isApiKey(status),
        limits: this.options.limits(home.key),
        usage: this.options.usage(home.key),
      }
    })
    return {
      active: this.options.active(),
      accounts,
      login: this.current,
      loginBlock: this.options.loginBlock(),
      apps: this.options.apps.list(),
      pool: this.options.pool(),
    }
  }

  emailOf(key: string): string | null {
    return this.known.find((known) => known.home.key === key)?.status?.email ?? null
  }

  apiKey(key: string): boolean {
    return isApiKey(this.known.find((known) => known.home.key === key)?.status ?? null)
  }

  /** When the credit of an API account's key came back after its session stopped on it at `at`; asking keeps it checked. */
  creditBackAfter(key: string, at: string): string | null {
    return this.credit.restoredAfter(key, at, this.options.now())
  }

  start(): void {
    if (this.timer !== undefined) return
    const tick = () => {
      void this.refresh().finally(() => {
        this.timer = setTimeout(tick, this.options.intervalMs)
      })
    }
    tick()
  }

  async refresh(): Promise<void> {
    await this.removeFinished()
    const homes = this.options.homes.list()
    const known = await Promise.all(homes.map((home) => this.check(home)))
    const keysChanged = await this.checkKeys(known)
    await this.checkCredit(homes)
    if (!keysChanged && JSON.stringify(known) === JSON.stringify(this.known)) return
    this.known = known
    this.options.onChange()
  }

  /** A new account of the agent, signed in in a folder of its own. */
  add(agent: string): void {
    this.requireIdle()
    this.begin(this.options.homes.pending(this.options.now(), agent), true)
  }

  async addApiKey(name: string, key: string, agent: string): Promise<void> {
    const value = assertApiKey(key, agent)
    const verdict = await this.options.checkKey(agent, value)
    const codex = agent === CODEX
    if (verdict.state === 'rejected') throw fail(codex ? 'account.codexKeyRejected' : 'account.apiKeyRejected', {})
    if (verdict.state === 'unknown') throw fail(codex ? 'account.codexKeyUnchecked' : 'account.apiKeyUnchecked', { reason: verdict.reason })
    const home = this.options.homes.addApiKey(name, value, agent)
    this.keys.note(home.key, verdict, this.options.now())
    this.options.name(home.key, name)
    await this.refresh()
  }

  renew(key: string): void {
    this.requireIdle()
    const home = this.options.homes.find(key)
    if (home === undefined) throw fail('account.unknown', { key })
    const blocked = key === this.options.active() ? this.options.loginBlock() : null
    if (blocked !== null) throw new NoticeError(loginBlockNotice(blocked))
    this.begin(home, false)
  }

  switchTo(key: string): void {
    const problem = switchProblem(this.view, key)
    if (problem !== undefined) throw new NoticeError(problem)
    this.options.activate(key)
  }

  async switchApp(app: string, key: string): Promise<void> {
    await this.options.apps.refresh()
    const problem = appSwitchProblem(this.view, app, key)
    if (problem !== undefined) throw new NoticeError(problem)
    const home = this.options.homes.find(key)!
    await this.options.prepare(home)
    this.options.apps.point(app as AppId, home)
    await this.options.apps.refresh()
  }

  async remove(key: string): Promise<void> {
    const problem = removeProblem(this.view, key)
    if (problem !== undefined) throw new NoticeError(problem)
    if (!this.options.sessionsKnown() || this.options.sessionsIn(key).length > 0) {
      this.options.markRemoving(key, true)
      this.options.onChange()
      return
    }
    await this.drop(key)
    await this.refresh()
  }

  keep(key: string): void {
    if (!this.options.removing(key)) throw fail('account.notRemoving', { key })
    this.options.markRemoving(key, false)
    this.options.onChange()
  }

  private async removeFinished(): Promise<void> {
    if (!this.options.sessionsKnown()) return
    const view = this.view
    for (const entry of view.accounts) {
      if (!entry.removing || entry.sessions.length > 0 || removeProblem(view, entry.key) !== undefined) continue
      try {
        await this.drop(entry.key)
      } catch (error) {
        this.options.onError(error)
      }
    }
  }

  /** Asks Anthropic or OpenAI about each API account's key once per `keyCheckMs`; true when a verdict changed. */
  private async checkKeys(known: Known[]): Promise<boolean> {
    const now = this.options.now()
    const due = known.filter(({ home, status }) => isApiKey(status) && this.keys.due(home.key, now))
    const changes = await Promise.all(
      due.map(async ({ home }) => {
        const key = this.options.homes.apiKeyOf(home)
        if (key === null) return false
        const before = this.keys.rejected(home.key)
        this.keys.note(home.key, await this.options.checkKey(home.agent, key), now)
        return this.keys.rejected(home.key) !== before
      }),
    )
    return changes.includes(true)
  }

  private async checkCredit(homes: AccountHome[]): Promise<void> {
    const now = this.options.now()
    await Promise.all(
      this.credit.due(now).map(async (account) => {
        const home = homes.find((each) => each.key === account)
        const key = home === undefined ? null : this.options.homes.apiKeyOf(home)
        if (home === undefined || key === null) return
        const verdict = await this.options.checkCredit(home.agent, key)
        if (verdict.state === 'unknown') this.options.onError(new Error(`credit check of ${account}: ${verdict.reason}`))
        this.credit.note(account, verdict, now)
      }),
    )
  }

  private async drop(key: string): Promise<void> {
    const home = this.options.homes.find(key)!
    const status = this.known.find((known) => known.home.key === key)?.status
    if (status?.loggedIn === true && !isApiKey(status)) await this.options.agentOf(home).logout(home)
    this.options.homes.remove(home)
    this.options.forget(key)
    this.keys.forget(key)
    this.credit.forget(key)
  }

  code(code: string): void {
    if (this.running === undefined || this.current === null) throw fail('login.none', {})
    this.running.child.stdin.write(`${code}\n`)
    this.current = { ...this.current, codeSent: true }
    this.options.onChange()
  }

  cancel(): void {
    const running = this.running
    this.running = undefined
    this.current = null
    running?.child.kill()
    if (running?.adding) this.discard(running.home)
    this.options.onChange()
  }

  private async check(home: AccountHome): Promise<Known> {
    const before = this.known.find((known) => known.home.key === home.key)
    try {
      return { home, status: withIdentity(await this.options.agentOf(home).authStatus(home), home.key), error: null }
    } catch (reason) {
      const error = noticeOf(reason)
      if (!sameNotice(error, before?.error ?? null)) this.options.onError(reason)
      return { home, status: before?.status ?? null, error }
    }
  }

  private requireIdle(): void {
    if (this.running !== undefined) throw fail('login.running', {})
  }

  private begin(home: AccountHome, adding: boolean): void {
    const child = this.options.agentOf(home).login(home)
    const running = { child, home, adding }
    this.running = running
    this.output = ''
    this.current = {
      agent: home.agent,
      target: adding ? null : home.key,
      startedAt: this.options.now().toISOString(),
      urls: [],
      output: '',
      error: null,
      codeSent: false,
    }
    const timeout = setTimeout(() => {
      this.fail(running, notice('login.timeout', { minutes: Math.round(this.options.loginTimeoutMs / 60_000) }))
      child.kill()
    }, this.options.loginTimeoutMs)

    const read = (chunk: Buffer) => {
      if (this.running !== running || this.current === null) return
      this.output = (this.output + chunk.toString('utf8')).slice(-MAX_OUTPUT_CHARS)
      const urls = [...new Set([...this.current.urls, ...loginUrls(this.output)])]
      this.current = { ...this.current, urls, output: cleanOutput(this.output).trim().slice(-SHOWN_OUTPUT_CHARS) }
      this.options.onChange()
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('error', (error) => {
      clearTimeout(timeout)
      this.fail(running, notice('login.startFailed', {}, { detail: error.message }))
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0 && this.running === running) {
        void this.finish(running)
        return
      }
      const lastLine = cleanOutput(this.output).trim().split('\n').at(-1) ?? ''
      this.fail(running, notice('login.exited', { code: String(code) }, { detail: lastLine }))
    })
    this.options.onChange()
  }

  private async finish(running: Running): Promise<void> {
    try {
      if (running.adding) {
        const agent = this.options.agentOf(running.home)
        const status = await agent.authStatus(running.home)
        const refused = secondFreeProblem(this.view.accounts, running.home.agent, status)
        if (refused !== undefined) {
          await agent.logout(running.home).catch((error: unknown) => this.options.onError(error))
          this.fail(running, refused)
          return
        }
        const home = this.options.homes.place(running.home, status.email)
        this.options.homes.share(home)
      }
    } catch (error) {
      running.adding = false
      this.fail(running, notice('login.setupFailed', { dir: running.home.dir }, { cause: noticeOf(error) }))
      return
    }
    if (this.running !== running) return
    this.running = undefined
    this.current = null
    this.options.onChange()
    await this.refresh()
  }

  private fail(running: Running, error: Notice): void {
    if (this.running !== running || this.current === null) return
    this.running = undefined
    this.current = { ...this.current, error }
    if (running.adding) this.discard(running.home)
    this.options.onChange()
  }

  private discard(home: AccountHome): void {
    try {
      this.options.homes.remove(home)
    } catch (error) {
      this.options.onError(error)
    }
  }
}
