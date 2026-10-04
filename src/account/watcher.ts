import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { RateLimits } from '../limits/model.js'
import type { UsageHealth } from '../limits/usage.js'
import { fail, notice, NoticeError, noticeOf, sameNotice, type Notice } from '../notice/notice.js'
import { appSwitchProblem, type AppAccount, type AppId } from './apps.js'
import type { AccountHome, AccountHomes } from './homes.js'
import {
  cleanOutput,
  loginBlockNotice,
  loginUrls,
  needsLogin,
  removeProblem,
  switchProblem,
  type AccountEntry,
  type AccountLogin,
  type AccountView,
  type ClaudeAccount,
  type LoginBlock,
} from './model.js'

const MAX_OUTPUT_CHARS = 16 * 1024
const SHOWN_OUTPUT_CHARS = 2 * 1024

export interface AccountCli {
  authStatus: (home: AccountHome) => Promise<ClaudeAccount>
  authLogin: (home: AccountHome) => ChildProcessWithoutNullStreams
  authLogout: (home: AccountHome) => Promise<void>
}

export interface AppControl {
  list: () => AppAccount[]
  refresh: () => Promise<void>
  point: (app: AppId, home: AccountHome) => void
}

export interface AccountWatcherOptions {
  homes: AccountHomes
  cli: AccountCli
  apps: AppControl
  prepare: (home: AccountHome) => Promise<void>
  active: () => string
  activate: (key: string) => void
  forget: (key: string) => void
  loginBlock: () => LoginBlock | null
  sessionsIn: (key: string) => string[]
  sessionsKnown: () => boolean
  removing: (key: string) => boolean
  markRemoving: (key: string, on: boolean) => void
  configPending: (key: string) => boolean
  limits: (key: string) => RateLimits | null
  usage: (key: string) => UsageHealth
  intervalMs: number
  loginTimeoutMs: number
  now: () => Date
  onChange: () => void
  onError: (error: unknown) => void
}

interface Known {
  home: AccountHome
  status: ClaudeAccount | null
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

  constructor(private readonly options: AccountWatcherOptions) {}

  get view(): AccountView {
    const now = this.options.now()
    const accounts = this.known.map(({ home, status, error }): AccountEntry => {
      const times = this.options.homes.times(home)
      return {
        key: home.key,
        global: home.global,
        status,
        error,
        loginExpiresAt: times.loginExpiresAt === null || times.erased ? null : new Date(times.loginExpiresAt).toISOString(),
        needsLogin: needsLogin(status, times, now),
        sessions: this.options.sessionsIn(home.key),
        removing: this.options.removing(home.key),
        configPending: this.options.configPending(home.key),
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
    }
  }

  emailOf(key: string): string | null {
    return this.known.find((known) => known.home.key === key)?.status?.email ?? null
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
    if (JSON.stringify(known) === JSON.stringify(this.known)) return
    this.known = known
    this.options.onChange()
  }

  add(): void {
    this.requireIdle()
    this.begin(this.options.homes.pending(this.options.now()), true)
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

  private async drop(key: string): Promise<void> {
    const home = this.options.homes.find(key)!
    const status = this.known.find((known) => known.home.key === key)?.status
    if (status?.loggedIn === true) await this.options.cli.authLogout(home)
    this.options.homes.remove(home)
    this.options.forget(key)
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
      return { home, status: await this.options.cli.authStatus(home), error: null }
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
    const child = this.options.cli.authLogin(home)
    const running = { child, home, adding }
    this.running = running
    this.output = ''
    this.current = {
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
        const status = await this.options.cli.authStatus(running.home)
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
