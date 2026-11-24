import type { ActiveChain } from '../../src/chain/dispatcher.js'
import { remoteLandings, resolvingLanding } from '../../src/chain/landing-hold.js'
import type { Notice } from '../../src/notice/notice.js'
import { heldPackages } from '../../src/packages/held.js'
import type { EvenKeelState, PackagesHeld, WaitedPackage } from '../../src/state.js'
import { activeChain } from './state.js'
import { PASSING } from './tools/packageView.js'

type CiWait = NonNullable<ActiveChain['ciWait']>
type LimitsWait = NonNullable<ActiveChain['limitsWait']>

export type { WaitedPackage }

/**
 * What a running chain waits for before its next task (BTN-657). `passing` — the packages only install or start, which
 * passes by itself; otherwise a server does not answer. A package only the user can fix pauses the chain instead
 * (`chain.packagesNotReady`), so it is not a wait.
 */
export type ChainWait =
  /** A session of the project resolves its landing and the `landingHold` setting is on: no next task starts (BTN-1582). */
  | { kind: 'landing'; task: string }
  /** The task's landing waits for a remote out of reach: it is not closed until the remote answers or it is closed without a push. */
  | { kind: 'remote'; task: string }
  | { kind: 'closing'; task: string }
  | { kind: 'ci'; wait: CiWait }
  | { kind: 'limits'; wait: LimitsWait }
  | { kind: 'limit'; until: string }
  | { kind: 'model'; model: string; until: string | null }
  | { kind: 'gateway'; error: Notice }
  | { kind: 'packages'; packages: WaitedPackage[]; passing: boolean }
  /** The same wait on the lane's machine that is not the hub's own (`ActiveChain.packagesWait`, BTN-1524): its id and name. */
  | { kind: 'machinePackages'; machine: string; name: string; packages: WaitedPackage[]; gateway: boolean; passing: boolean }
  /** `folder` — a released task's session works in the shared folder of a project without git (BTN-962). */
  | { kind: 'slot' | 'folder'; notice: Notice }

type WaitState = Pick<EvenKeelState, 'chain' | 'packages' | 'machineNames'> & { config?: Pick<EvenKeelState['config'], 'projects'> }

/**
 * In the order the dispatcher checks them (`Dispatcher.step`): the first is what the chip names. The landings come
 * first and stand while the project's head lane works a task: they hold the project, not the lane.
 */
export function chainWaits(state: WaitState, project: string): ChainWait[] {
  const chain = activeChain(state.chain, project)
  if (chain === undefined || chain.paused) return []
  const waits = landingWaits(state, project)
  if (chain.current !== null) return waits
  if (chain.closing !== undefined) waits.push({ kind: 'closing', task: chain.closing })
  if (chain.ciWait !== undefined) waits.push({ kind: 'ci', wait: chain.ciWait })
  if (chain.limitsWait !== undefined) waits.push({ kind: 'limits', wait: chain.limitsWait })
  if (chain.limitUntil !== undefined) waits.push({ kind: 'limit', until: chain.limitUntil })
  if (chain.modelWeek !== undefined) waits.push({ kind: 'model', model: chain.modelWeek.model, until: chain.modelWeek.until })
  const held = chain.packagesWait
  const packages = chain.closing !== undefined || chain.fixOnly === true ? null
    : held !== undefined ? machineWait(held, state.machineNames?.[held.machine] ?? held.machine)
    : packagesWait(state.packages, project)
  if (packages !== null) waits.push(packages)
  if (chain.slotWait !== undefined) waits.push({ kind: chain.slotWait.notice.code === 'folder.busy' ? 'folder' : 'slot', notice: chain.slotWait.notice })
  return waits
}

function landingWaits(state: WaitState, project: string): ChainWait[] {
  const landings = state.chain.landings?.[project]
  if (landings === undefined) return []
  const lanes = state.chain.active.filter((lane) => lane.project === project)
  // The setting as the project ends up with it; a view without the config is the default, on.
  const resolving = state.config?.projects[project]?.landingHold === false ? undefined : resolvingLanding(landings, lanes)
  return [
    ...(resolving === undefined ? [] : [{ kind: 'landing' as const, task: resolving }]),
    ...remoteLandings(landings, lanes).map((task) => ({ kind: 'remote' as const, task })),
  ]
}

/** The packages hold the next launch (`Packages.blocked`): the gateway does not run, or an enabled package is not ready. */
function packagesWait(view: EvenKeelState['packages'], project: string): ChainWait | null {
  if (view.projects[project]?.blocked !== true) return null
  if (view.gateway !== null) return { kind: 'gateway', error: view.gateway }
  const packages = heldPackages(view.projects[project])
  // Held by the set as a whole (`noTrackerMcp`): the chain pauses on it rather than waits.
  if (packages.length === 0) return null
  return { kind: 'packages', packages, passing: passingAll(packages) }
}

/**
 * The lane's machine is not the hub's own and its packages hold the launch (BTN-1524): the hub's own set may be fine.
 * Neither a list nor the gateway — a machine older than the list, which only says it is held.
 */
function machineWait(held: PackagesHeld & { machine: string }, name: string): ChainWait {
  const { machine, packages } = held
  const gateway = held.gateway === true
  return { kind: 'machinePackages', machine, name, packages, gateway, passing: !gateway && packages.length > 0 && passingAll(packages) }
}

const passingAll = (packages: WaitedPackage[]) => packages.every((each) => each.problems.every((problem) => PASSING.has(problem.kind)))
