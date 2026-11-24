import { API_VERSION } from '../link/protocol.js'
import type { HubBuild, MachineAbout, MachineFollow } from '../link/view.js'
import { fail, notice, type Notice } from '../notice/notice.js'
import { SETTLE_MS } from '../updates/runner.js'

/** How often a settle looks at the machine's lanes again, as the hub's own update does. */
const SETTLE_POLL_MS = 5_000

/**
 * How a machine's build stands to the hub's (BTN-1609): `protocol` — another API of the link, which the handshake
 * refuses, so it takes no work; `build` — another commit or version on the same API: it works, its page marks it.
 */
export type BuildGap = 'protocol' | 'build' | null

export function buildGap(hub: HubBuild, about: MachineAbout): BuildGap {
  if (about.api !== undefined && about.api !== API_VERSION) return 'protocol'
  if (hub.commit !== undefined && about.commit !== undefined) return hub.commit === about.commit ? null : 'build'
  return about.evenKeel === hub.evenKeel && (hub.commit === undefined) === (about.commit === undefined) ? null : 'build'
}

/**
 * The build a machine of another one moves to by itself: a checkout to the hub's commit, a package of npm to the
 * hub's version. None — the same build, a checkout beside a hub with no commit, or a container, which Docker replaces.
 */
export function followTarget(hub: HubBuild, about: MachineAbout): HubBuild | undefined {
  if (about.container === true) return undefined
  if (about.commit !== undefined) return hub.commit !== undefined && hub.commit !== about.commit ? hub : undefined
  return hub.evenKeel !== undefined && hub.evenKeel !== about.evenKeel ? { evenKeel: hub.evenKeel } : undefined
}

/** What the page names: the commit's short form, or the version. */
const toOf = (target: HubBuild): string => target.commit ?? target.evenKeel ?? ''
const shown = (to: string): string => (/^[0-9a-f]{40}$/.test(to) ? to.slice(0, 7) : to)

export interface MachineUpdatesOptions {
  hub: HubBuild
  /** The projects whose lanes on the machine a restart would cut now (`busyChains` of those lanes). */
  busy: (machine: string) => string[]
  /** `update.follow` on the machine (`MachineNetwork.follow`): `null` — it moves; else what keeps it, already in its report. */
  ask: (machine: string, build: HubBuild, force: boolean) => Promise<MachineFollow | null>
  name: (machine: string) => string
  /** An entry of the event log opening the machine's page. */
  notify: (notice: Notice, machine: string) => void
  log: (line: string) => void
  settleMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * The machines elsewhere coming to the hub's build (BTN-1609): at each snapshot of a machine whose report names
 * another commit (a checkout) or version (a package) on the same API, the hub waits for its lanes to settle, as its
 * own update does, and asks it once per target and process to move (`update.follow`, its `HubFollower`). "Update" on
 * the machine's page asks again, a failed target too. What keeps a machine where it is, and an update that failed
 * there, go to the log and the event log.
 */
export class MachineUpdates {
  /** `machine\0to` already asked for, or told failed: the next snapshots ask nothing. */
  private readonly asked = new Set<string>()
  private readonly failures = new Set<string>()
  /** By machine, the target it took and is moving to: until a report of another build comes. */
  private readonly taken = new Map<string, string>()

  constructor(private readonly options: MachineUpdatesOptions) {}

  /** The target the machine took and is moving to; `undefined` — none under way as far as the hub knows. */
  moving(machine: string): string | undefined {
    return this.taken.get(machine)
  }

  /** A snapshot of the machine came: its report is its build now. Resolves once the ask, if any, is answered. */
  async seen(machine: string, about: MachineAbout): Promise<void> {
    const target = followTarget(this.options.hub, about)
    if (target === undefined || buildGap(this.options.hub, about) === 'protocol') {
      this.taken.delete(machine)
      return
    }
    const to = toOf(target)
    if (this.taken.get(machine) !== to) this.taken.delete(machine)
    const key = `${machine}\0${to}`
    if (about.follow?.stuck === 'failed' && about.follow.to === to) {
      this.asked.add(key)
      this.taken.delete(machine)
      if (!this.failures.has(key)) {
        this.failures.add(key)
        this.options.log(`machines: machine ${machine} (${this.options.name(machine)}): its update to the hub's ${to} failed and was rolled back; its log is logs/update.log there`)
        this.options.notify(notice('machines.updateFailed', { name: this.options.name(machine), to: shown(to) }), machine)
      }
      return
    }
    if (this.asked.has(key)) return
    this.asked.add(key)
    const from = about.commit ?? about.evenKeel
    this.options.log(`machines: machine ${machine} (${this.options.name(machine)}) runs ${from}, the hub ${to}: it is asked to come to the hub's build once its lanes settle`)
    await this.run(machine, target, false)
  }

  /** "Update" on the machine's page: asks at once after the settle, a target an update failed at too. */
  update(machine: string, about: MachineAbout): Promise<void> {
    const target = followTarget(this.options.hub, about)
    if (target === undefined || buildGap(this.options.hub, about) === 'protocol') throw fail('machines.noUpdate', { name: this.options.name(machine) })
    const key = `${machine}\0${toOf(target)}`
    this.asked.add(key)
    this.failures.delete(key)
    this.options.log(`machines: "Update" of machine ${machine} (${this.options.name(machine)}) to the hub's ${toOf(target)} asked from the page`)
    return this.run(machine, target, true)
  }

  private async run(machine: string, target: HubBuild, force: boolean): Promise<void> {
    const { options } = this
    const now = options.now ?? Date.now
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    const deadline = now() + (options.settleMs ?? SETTLE_MS)
    let busy = options.busy(machine)
    while (busy.length > 0 && now() < deadline) {
      await sleep(SETTLE_POLL_MS)
      busy = options.busy(machine)
    }
    if (busy.length > 0) options.log(`machines: ${busy.join(', ')} did not settle on machine ${machine}, it updates anyway`)
    const to = toOf(target)
    const name = options.name(machine)
    let answer: MachineFollow | null
    try {
      answer = await options.ask(machine, target, force)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      options.log(`machines: machine ${machine} (${name}) was not asked to update to ${to}: ${message}`)
      options.notify(notice('machines.updateFailed', { name, to: shown(to) }, { detail: message }), machine)
      return
    }
    if (answer === null) {
      this.taken.set(machine, to)
      options.log(`machines: machine ${machine} (${name}) moves to the hub's ${to}`)
      return
    }
    this.taken.delete(machine)
    options.log(`machines: machine ${machine} (${name}) does not move to the hub's ${to}: ${answer.stuck}`)
    const code = answer.stuck === 'dirty' ? 'machines.updateDirty' : answer.stuck === 'manual' ? 'machines.updateManual' : 'machines.updateFailed'
    options.notify(notice(code, { name, to: shown(answer.to) }), machine)
  }
}
