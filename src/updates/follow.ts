import { join } from 'node:path'
import { imageTagOf } from '../cli-install.js'
import type { VersionRefusal } from '../link/protocol.js'
import type { HubBuild, MachineFollow } from '../link/view.js'
import { LINK_FILE } from '../machine/join.js'
import { readCheckout } from './checkout.js'
import type { ServiceControl } from './control.js'
import { launchRunner } from './launch.js'
import type { Checkout, InstallSource, UpdateRecord } from './model.js'
import { globalPrefixOf } from './prefix.js'
import { ANSWER_MS, LOG_FILE, readRecord, RESULT_FILE, STEADY_MS, type UpdatePlan } from './runner.js'

export interface FollowOptions {
  root: string
  /** The data folder: `logs/update.json` and `logs/update.log` are there. */
  home: string
  /** `state/` of the installation: its `machine-link.json` gets `contactAt` once the hub takes the machine. */
  stateDir: string
  source: InstallSource
  /** The installed version. */
  current: string
  /** It runs in a container (BTN-1440): Docker replaces it, it never updates itself. */
  container?: boolean
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
 * A machine of a hub catching up with it (BTN-1275): at a refusal of its API version, or when a hub of the same API
 * asks it to come to its build (BTN-1609), it moves itself to the hub's commit (a checkout) or version (a global
 * package of npm) through the update process, once per process, and never again to a target it already failed at
 * unless the person asks. What keeps it where it is goes to its report (`MachineAbout.follow`).
 */
export class HubFollower {
  private stuck: MachineFollow | undefined
  /** A refusal or an ask is being looked at, or the update process took one: the next ones wait for this process to stop. */
  private taken = false

  constructor(private readonly options: FollowOptions) {}

  view(): MachineFollow | undefined {
    return this.stuck
  }

  async refused(refusal: VersionRefusal): Promise<void> {
    await this.take({ ...(refusal.evenKeel !== undefined && { evenKeel: refusal.evenKeel }), ...(refusal.commit !== undefined && { commit: refusal.commit }) }, false, false)
  }

  /**
   * The hub of the same API asks for its build (`update.follow`): `force` tries again a target an update already
   * failed at. `null` — the update process took it, one runs already, or this installation runs that build.
   */
  async asked(build: HubBuild, force: boolean): Promise<MachineFollow | null> {
    if (this.taken) return null
    await this.take(build, true, force)
    return this.stuck ?? null
  }

  private async take(build: HubBuild, asked: boolean, force: boolean): Promise<boolean> {
    if (this.taken) return false
    this.taken = true
    let launched = false
    try {
      launched = await this.follow(build, asked, force)
    } finally {
      if (!launched) this.taken = false
    }
    return launched
  }

  /** `asked` — the hub of the same API asked: the build this installation runs already is no failure, nothing is due. */
  private async follow(build: HubBuild, asked: boolean, force: boolean): Promise<boolean> {
    const { options } = this
    if (asked && options.source === 'npm' && build.evenKeel === options.current) return this.arrived()
    if (options.container) {
      const version = build.evenKeel
      if (version === undefined) return false
      return this.stay(version, 'manual', `it runs in a container: put EVEN_KEEL_IMAGE_TAG=${imageTagOf(version)} in the Compose folder's .env and run docker compose pull && docker compose up -d there`)
    }
    const npm = options.source === 'npm'
    const target: Target | undefined = npm
      ? build.evenKeel !== undefined && build.evenKeel !== options.current ? { version: build.evenKeel, ref: `v${build.evenKeel}` } : undefined
      : build.commit !== undefined ? { version: build.evenKeel ?? options.current, ref: build.commit } : undefined
    const named = npm ? build.evenKeel : (build.commit ?? build.evenKeel)
    if (target === undefined) return named === undefined ? false : this.stay(named, 'manual', 'the hub names nothing this installation can move to by itself')
    const to = npm ? target.version : target.ref
    const last = options.record ? options.record() : readRecord(join(options.home, RESULT_FILE))
    if (!force && last?.mode === 'follow' && last.failed !== null && last.to?.tag === target.ref) return this.stay(to, 'failed', `its update to ${to} failed at ${last.failed.step}`)
    const control = await options.control()
    if (control === null) return this.stay(to, 'manual', 'no service manager runs it here')
    const prefix = npm ? globalPrefixOf(options.root, options.platform ?? process.platform) : null
    if (npm && prefix === null) return this.stay(to, 'manual', 'the package is not a global install')
    const checkout = npm ? null : await (options.checkout ?? readCheckout)(options.root)
    if (!npm && checkout === null) return this.stay(to, 'manual', `${options.root} is no git checkout`)
    if (checkout?.dirty === true) return this.stay(to, 'dirty', 'its checkout has changes in tracked files')
    if (checkout?.commit === target.ref) return asked ? this.arrived() : this.stay(to, 'failed', 'it runs that commit already, rebuild it')
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

  /** It runs the build the hub asked for: nothing keeps it anywhere. */
  private arrived(): false {
    this.stuck = undefined
    return false
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
