import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VersionRefusal } from '../link/protocol.js'
import type { MachineFollow } from '../link/view.js'
import { LINK_FILE } from '../machine/join.js'
import { readCheckout } from './checkout.js'
import type { ServiceControl } from './control.js'
import { launchRunner } from './launch.js'
import { recordOf, type Checkout, type InstallSource, type UpdateRecord } from './model.js'
import { globalPrefixOf } from './prefix.js'
import { ANSWER_MS, LOG_FILE, RESULT_FILE, STEADY_MS, type UpdatePlan } from './runner.js'

export interface FollowOptions {
  root: string
  /** The data folder: `logs/update.json` and `logs/update.log` are there. */
  home: string
  /** `state/` of the installation: its `machine-link.json` gets `contactAt` once the hub takes the machine. */
  stateDir: string
  source: InstallSource
  /** The installed version. */
  current: string
  control: () => Promise<ServiceControl | null>
  checkout?: (root: string) => Promise<Checkout | null>
  /** `logs/update.json`; `null` — none or unreadable. */
  record?: () => UpdateRecord | null
  packageName?: string
  platform?: NodeJS.Platform
  launch?: (plan: UpdatePlan, onError: (error: Error) => void) => void
  log: (line: string) => void
}

/** Where a machine moves: the hub's commit for a checkout, its version for a package. */
interface Target {
  version: string
  ref: string
}

/**
 * A machine of a hub catching up with it (BTN-1275): at a refusal of its API version it moves itself to the hub's
 * commit (a checkout) or version (a global package of npm) through the update process, once per process, and never
 * again to a target it already failed at. What keeps it where it is goes to its report (`MachineAbout.follow`).
 */
export class HubFollower {
  private stuck: MachineFollow | undefined
  /** A refusal is being looked at, or the update process took one: the next ones wait for this process to stop. */
  private taken = false

  constructor(private readonly options: FollowOptions) {}

  view(): MachineFollow | undefined {
    return this.stuck
  }

  async refused(refusal: VersionRefusal): Promise<void> {
    if (this.taken) return
    this.taken = true
    let launched = false
    try {
      launched = await this.follow(refusal)
    } finally {
      if (!launched) this.taken = false
    }
  }

  private async follow(refusal: VersionRefusal): Promise<boolean> {
    const { options } = this
    const npm = options.source === 'npm'
    const target: Target | undefined = npm
      ? refusal.evenKeel !== undefined && refusal.evenKeel !== options.current ? { version: refusal.evenKeel, ref: `v${refusal.evenKeel}` } : undefined
      : refusal.commit !== undefined ? { version: refusal.evenKeel ?? options.current, ref: refusal.commit } : undefined
    const named = npm ? refusal.evenKeel : (refusal.commit ?? refusal.evenKeel)
    if (target === undefined) return named === undefined ? false : this.stay(named, 'manual', 'the hub names nothing this installation can move to by itself')
    const to = npm ? target.version : target.ref
    const last = (options.record ?? (() => readRecord(options.home)))()
    if (last?.mode === 'follow' && last.failed !== null && last.to?.tag === target.ref) return this.stay(to, 'failed', `its update to ${to} failed at ${last.failed.step}`)
    const control = await options.control()
    if (control === null) return this.stay(to, 'manual', 'no service manager runs it here')
    const prefix = npm ? globalPrefixOf(options.root, options.platform ?? process.platform) : null
    if (npm && prefix === null) return this.stay(to, 'manual', 'the package is not a global install')
    const checkout = npm ? null : await (options.checkout ?? readCheckout)(options.root)
    if (!npm && checkout === null) return this.stay(to, 'manual', `${options.root} is no git checkout`)
    if (checkout?.dirty === true) return this.stay(to, 'dirty', 'its checkout has changes in tracked files')
    if (checkout?.commit === target.ref) return this.stay(to, 'failed', 'it runs that commit already, rebuild it')
    const plan: UpdatePlan = {
      mode: 'follow',
      install: null,
      ...(prefix !== null && { package: { name: options.packageName ?? 'even-keel', prefix } }),
      root: options.root,
      home: options.home,
      target: { version: target.version, tag: target.ref },
      from: { version: options.current, commit: checkout?.commit ?? '', branch: checkout?.branch ?? null, tag: null, storage: null },
      service: { stop: control.stop, start: control.start },
      state: '',
      startedAt: null,
      settleMs: 0,
      answerMs: ANSWER_MS,
      steadyMs: STEADY_MS,
      log: join(options.home, LOG_FILE),
      result: join(options.home, RESULT_FILE),
      machine: { contact: join(options.stateDir, LINK_FILE) },
    }
    const failed = (error: Error) => this.stay(to, 'failed', `the update process did not start: ${error.message}`)
    try {
      ;(options.launch ?? launchRunner)(plan, failed)
    } catch (error) {
      failed(error instanceof Error ? error : new Error(String(error)))
      return true
    }
    this.stuck = undefined
    options.log(`link: this machine moves itself to the hub's ${npm ? 'version' : 'commit'} ${to}; the update's log is ${LOG_FILE}`)
    return true
  }

  /** Logged once per reason and target; `false` — nothing was launched. */
  private stay(to: string, stuck: MachineFollow['stuck'], why: string): false {
    if (this.stuck?.to !== to || this.stuck.stuck !== stuck) {
      this.options.log(`link: this machine does not move itself to the hub's ${to}: ${why}; install it by hand`)
    }
    this.stuck = { to, stuck }
    return false
  }
}

function readRecord(home: string): UpdateRecord | null {
  try {
    return recordOf(JSON.parse(readFileSync(join(home, RESULT_FILE), 'utf8')))
  } catch {
    return null
  }
}
