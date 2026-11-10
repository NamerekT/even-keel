import type { ActiveChain } from '../../src/chain/dispatcher.js'
import type { Notice } from '../../src/notice/notice.js'
import type { EvenKeelState, PackageProblem } from '../../src/state.js'
import { activeChain } from './state.js'
import { PASSING } from './tools/packageView.js'

type CiWait = NonNullable<ActiveChain['ciWait']>
type LimitsWait = NonNullable<ActiveChain['limitsWait']>

export interface WaitedPackage {
  name: string
  problems: PackageProblem[]
}

/**
 * What a running chain waits for before its next task (BTN-657). `passing` — the packages only install or start, which
 * passes by itself; otherwise a server does not answer. A package only the user can fix pauses the chain instead
 * (`chain.packagesNotReady`), so it is not a wait.
 */
export type ChainWait =
  | { kind: 'closing'; task: string }
  | { kind: 'ci'; wait: CiWait }
  | { kind: 'limits'; wait: LimitsWait }
  | { kind: 'limit'; until: string }
  | { kind: 'model'; model: string; until: string | null }
  | { kind: 'gateway'; error: Notice }
  | { kind: 'packages'; packages: WaitedPackage[]; passing: boolean }
  /** `folder` — a released task's session works in the shared folder of a project without git (BTN-962). */
  | { kind: 'slot' | 'folder'; notice: Notice }

/** In the order the dispatcher checks them (`Dispatcher.step`): the first is what the chip names. */
export function chainWaits(state: Pick<EvenKeelState, 'chain' | 'packages'>, project: string): ChainWait[] {
  const chain = activeChain(state.chain, project)
  if (chain === undefined || chain.paused || chain.current !== null) return []
  const waits: ChainWait[] = []
  if (chain.closing !== undefined) waits.push({ kind: 'closing', task: chain.closing })
  if (chain.ciWait !== undefined) waits.push({ kind: 'ci', wait: chain.ciWait })
  if (chain.limitsWait !== undefined) waits.push({ kind: 'limits', wait: chain.limitsWait })
  if (chain.limitUntil !== undefined) waits.push({ kind: 'limit', until: chain.limitUntil })
  if (chain.modelWeek !== undefined) waits.push({ kind: 'model', model: chain.modelWeek.model, until: chain.modelWeek.until })
  const packages = chain.closing === undefined && chain.fixOnly !== true ? packagesWait(state.packages, project) : null
  if (packages !== null) waits.push(packages)
  if (chain.slotWait !== undefined) waits.push({ kind: chain.slotWait.notice.code === 'folder.busy' ? 'folder' : 'slot', notice: chain.slotWait.notice })
  return waits
}

/** The packages hold the next launch (`Packages.blocked`): the gateway does not run, or an enabled package is not ready. */
function packagesWait(view: EvenKeelState['packages'], project: string): ChainWait | null {
  if (view.projects[project]?.blocked !== true) return null
  if (view.gateway !== null) return { kind: 'gateway', error: view.gateway }
  const packages = Object.entries(view.projects[project]!.cells).flatMap(([name, cell]) => {
    const problems = cell.enabled ? cell.problems.filter((each) => each.kind !== 'unsupported') : []
    return problems.length === 0 ? [] : [{ name, problems }]
  })
  // Held by the set as a whole (`noTrackerMcp`): the chain pauses on it rather than waits.
  if (packages.length === 0) return null
  const passing = packages.every((each) => each.problems.every((problem) => PASSING.has(problem.kind)))
  return { kind: 'packages', packages, passing }
}
