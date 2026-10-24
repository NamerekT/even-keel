import { readFileSync, watchFile } from 'node:fs'
import { join } from 'node:path'
import type { ActiveChain } from '../chain/model.js'
import { fail } from '../notice/notice.js'
import { readCheckout } from './checkout.js'
import { serviceControl, type ServiceControl } from './control.js'
import { launchRunner } from './launch.js'
import {
  leftRunning,
  packageBlock,
  previousOf,
  recordOf,
  resultView,
  tagOf,
  updateBlock,
  type Checkout,
  type InstallSource,
  type NpmPackage,
  type StorageVersions,
  type UpdateProgress,
  type UpdateRecord,
} from './model.js'
import { globalPrefixOf } from './prefix.js'
import type { Release, UpdatesView } from './release.js'
import { ANSWER_MS, LOG_FILE, RESULT_FILE, SETTLE_MS, STEADY_MS, writeRecord, type UpdatePlan } from './runner.js'
import { busyChains } from './settle.js'

export interface UpdaterOptions {
  root: string
  /** The data folder: `logs/update.json` and `logs/update.log` are there. */
  home: string
  /** A package of npm is updated by `npm install --global`, not by moving a checkout (BTN-265). */
  source: InstallSource
  /** The installed version. */
  current: string
  storage: StorageVersions
  /** `startedAt` of this service: the update process waits for a later one. */
  startedAt: string
  active: () => readonly ActiveChain[]
  /** `/api/state` of this service, read at the launch: the address may move live. */
  stateUrl: () => string
  onChange: () => void
  log: (line: string) => void
  control?: () => Promise<ServiceControl | null>
  checkout?: (root: string) => Promise<Checkout | null>
  /** `name` of `package.json`, for a package of npm. */
  packageName?: string
  platform?: NodeJS.Platform
  launch?: (plan: UpdatePlan, onError: (error: Error) => void) => void
  sleep?: (ms: number) => Promise<void>
  settleMs?: number
  /** Calls `listener` when `file` changes; a missing file comes with `mtimeMs` 0. */
  watch?: (file: string, listener: (now: { mtimeMs: number }) => void) => void
}

const SETTLE_POLL_MS = 5_000
const WATCH_MS = 5_000

function watchRecord(file: string, listener: (now: { mtimeMs: number }) => void): void {
  watchFile(file, { interval: WATCH_MS }, listener).unref()
}
/** A commit or a checkout by hand changes what is offered; the update itself reads the checkout again anyway. */
const REFRESH_MS = 10 * 60_000

/** `/api/state` of a service listening on `host`: a wildcard address is reached on loopback. */
export function stateUrlOf(host: string, port: number): string {
  const reach = host === '' || host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  return `http://${reach.includes(':') ? `[${reach}]` : reach}:${port}/api/state`
}

/**
 * The page's "Update" and "Revert" (BTN-163): whether they are offered, the wait for the chains to settle, and the
 * launch of the update process, which stops this service, moves the checkout and starts it again. How it ended is
 * `logs/update.json`, read at the start.
 */
export class Updater {
  private control: ServiceControl | null | undefined
  private checkout: Checkout | null | undefined
  private record: UpdateRecord | null = null
  private progress: UpdateProgress | null = null

  constructor(private readonly options: UpdaterOptions) {}

  private get resultFile(): string {
    return join(this.options.home, RESULT_FILE)
  }

  /** The package and its global prefix; `undefined` — a checkout, `null` — a package outside a global install. */
  private get npmPackage(): NpmPackage | null | undefined {
    const { source, root, packageName } = this.options
    if (source !== 'npm') return undefined
    const prefix = globalPrefixOf(root, this.options.platform ?? process.platform)
    return prefix === null ? null : { name: packageName ?? 'even-keel', prefix }
  }

  async start(): Promise<void> {
    this.readRecord()
    // The update process writes the record after its answer step, so after this service started.
    const watch = this.options.watch ?? watchRecord
    watch(this.resultFile, (now) => {
      // A missing file is reported too: a launch failure kept only in memory stays.
      if (now.mtimeMs > 0 && this.readRecord()) this.options.onChange()
    })
    this.control = await (this.options.control ?? (() => serviceControl(this.options.root)))()
    if (this.control === null) this.options.log('updates: no service manager runs Even Keel here, the page offers no update')
    await this.refresh()
    setInterval(() => void this.refresh(), REFRESH_MS).unref()
  }

  /** Reads `logs/update.json`; `true` — the record changed. Its own `seen` write comes back here unchanged. */
  private readRecord(): boolean {
    let record: UpdateRecord | null
    try {
      record = recordOf(JSON.parse(readFileSync(this.resultFile, 'utf8')))
    } catch {
      record = null
    }
    const { current } = this.options
    if (record !== null && !leftRunning(record, current)) {
      const { mode, from, to } = record
      this.options.log(`updates: the last ${mode} from ${from.version}${to === null ? '' : ` to ${to.version}`} left another version than ${current} running, it was updated by other means; its result is not shown`)
      record = null
    }
    if (JSON.stringify(record) === JSON.stringify(this.record)) return false
    this.record = record
    if (record !== null && record.mode !== 'rebuild') {
      const { mode, from, to, failed, rollback } = record
      const how = failed === null ? 'went through' : `failed at ${failed.step}${rollback === null ? '' : rollback.failed === null ? ', rolled back' : `, the rollback failed at ${rollback.failed.step}`}`
      this.options.log(`updates: the last ${mode} from ${from.version}${to === null ? '' : ` to ${to.version}`} ${how}`)
    }
    return true
  }

  /** Reads the checkout again: its changes and tags decide whether "Update" is offered. */
  async refresh(): Promise<void> {
    const checkout = this.options.source === 'npm' ? null : await (this.options.checkout ?? readCheckout)(this.options.root)
    if (JSON.stringify(checkout) === JSON.stringify(this.checkout)) return
    this.checkout = checkout
    this.options.onChange()
  }

  view(): Pick<UpdatesView, 'source' | 'blocked' | 'previous' | 'progress' | 'result'> {
    const { current, storage, source } = this.options
    const npm = this.npmPackage
    const blocked =
      this.control === undefined ? 'checking' : npm === undefined ? updateBlock(this.control !== null, this.checkout, current) : packageBlock(this.control !== null, npm?.prefix ?? null)
    return {
      source,
      blocked,
      previous: previousOf(this.record, current, storage, blocked),
      progress: this.progress,
      result: this.progress === null ? resultView(this.record) : null,
    }
  }

  /** "Update" to `release`, the latest one. */
  async update(release: Release | null): Promise<void> {
    if (release === null) throw fail('updates.none', {})
    await this.begin('update', release.version, release.tag)
  }

  /** "Revert" to the version the last update came from. */
  async revert(): Promise<void> {
    await this.refresh()
    const previous = previousOf(this.record, this.options.current, this.options.storage, this.view().blocked)
    if (previous === null || this.record?.from.tag == null) throw fail('updates.noPrevious', {})
    if (previous.blocked !== null) throw fail('updates.blocked', { reason: previous.blocked })
    await this.begin('revert', previous.version, this.record.from.tag)
  }

  /** The page closed the result. */
  seen(): void {
    if (this.record === null || this.record.seen) return
    this.record = { ...this.record, seen: true }
    writeRecord(this.resultFile, this.record)
    this.options.onChange()
  }

  private async begin(mode: 'update' | 'revert', version: string, tag: string): Promise<void> {
    if (this.progress !== null) throw fail('updates.running', {})
    await this.refresh()
    const { blocked } = this.view()
    if (blocked !== null) throw fail('updates.blocked', { reason: blocked })
    const checkout = this.checkout ?? null
    const control = this.control!
    this.progress = { mode, target: version, phase: 'settling', waiting: busyChains(this.options.active()) }
    this.options.log(`updates: ${mode} to ${version} asked from the page`)
    this.options.onChange()
    void this.settleAndLaunch({ mode, version, tag, checkout, control })
  }

  /** `checkout` — `null` for a package of npm. */
  private async settleAndLaunch(target: { mode: 'update' | 'revert'; version: string; tag: string; checkout: Checkout | null; control: ServiceControl }): Promise<void> {
    const { options } = this
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    const deadline = Date.now() + (options.settleMs ?? SETTLE_MS)
    while (this.progress !== null && this.progress.waiting.length > 0 && Date.now() < deadline) {
      await sleep(SETTLE_POLL_MS)
      const waiting = busyChains(options.active())
      if (JSON.stringify(waiting) !== JSON.stringify(this.progress.waiting)) {
        this.progress = { ...this.progress, waiting }
        options.onChange()
      }
    }
    if (this.progress === null) return
    if (this.progress.waiting.length > 0) options.log(`updates: ${this.progress.waiting.join(', ')} did not settle, updating anyway`)
    const { mode, version, tag, checkout, control } = target
    const { current, storage } = options
    const npm = this.npmPackage ?? undefined
    // A package has no commit: npm brings back the version, its tag only marks a release "Revert" can go to.
    const from =
      checkout === null
        ? { version: current, commit: '', branch: null, tag: `v${current}`, storage }
        : { version: current, commit: checkout.commit, branch: checkout.branch, tag: tagOf(checkout, current), storage }
    const plan: UpdatePlan = {
      mode,
      install: 'ci',
      ...(npm === undefined ? {} : { package: npm }),
      root: options.root,
      home: options.home,
      target: { version, tag },
      from,
      service: { stop: control.stop, start: control.start },
      state: options.stateUrl(),
      startedAt: options.startedAt,
      settleMs: 0,
      answerMs: ANSWER_MS,
      steadyMs: STEADY_MS,
      log: join(options.home, LOG_FILE),
      result: this.resultFile,
    }
    this.progress = { ...this.progress, phase: 'running', waiting: [] }
    options.onChange()
    const failed = (error: Error) => {
      options.log(`updates: could not start the update process: ${error.message}`)
      const now = new Date().toISOString()
      this.record = { mode, from: plan.from, to: plan.target, startedAt: now, finishedAt: now, failed: { step: 'launch', output: error.message }, rollback: null, seen: false }
      this.progress = null
      options.onChange()
    }
    try {
      ;(options.launch ?? launchRunner)(plan, failed)
      options.log(`updates: the update process took the ${mode} to ${tag}; its log is ${LOG_FILE}`)
    } catch (error) {
      failed(error instanceof Error ? error : new Error(String(error)))
    }
  }
}
