/**
 * What a project's landings hold (BTN-1582): the dispatcher and the page both read them, so only types come in here.
 * `docs/chain/worktrees.md`, "Landing".
 */
import type { Landing } from './model.js'

export type LandingFacts = Pick<Landing, 'task' | 'resolving' | 'waitingRemote'>

/** What a lane is seen by here: its current task, if any. */
export interface LaneFacts {
  current: { task: string } | null
}

function current(lanes: readonly LaneFacts[], task: string): boolean {
  return lanes.some((lane) => lane.current?.task === task)
}

/**
 * The task whose session resolves its landing (a conflict or a red check) while it is current in a lane of the
 * project; `undefined` — none. While one does, a lane with the `landingHold` setting on starts no next task.
 */
export function resolvingLanding(landings: readonly LandingFacts[] | undefined, lanes: readonly LaneFacts[]): string | undefined {
  return landings?.find((landing) => landing.resolving === true && landing.waitingRemote !== true && current(lanes, landing.task))?.task
}

/** The tasks of the project, current in a lane, whose landing waits for a remote out of reach. */
export function remoteLandings(landings: readonly LandingFacts[] | undefined, lanes: readonly LaneFacts[]): string[] {
  return (landings ?? []).filter((landing) => landing.waitingRemote === true && current(lanes, landing.task)).map((landing) => landing.task)
}
