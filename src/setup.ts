import type { TallyMode } from './stats/mode.js'

/**
 * The first run (BTN-310): the stats are not chosen and there is no project yet. The page walks its setup (`/setup`),
 * whose last setting is the stats, and the service asks GitHub for no release meanwhile: the setup asks whether to.
 */
/**
 * The setup's steps that can be gone past with no setting of their own to tell it (BTN-1023): a skip of Git, Tracker or
 * Stats, and the update check, whose `updates.check` is on by default. `setupPassed` keeps them.
 */
export const PASSABLE_STEPS = ['git', 'tracker', 'updates', 'stats'] as const
export type PassableStep = (typeof PASSABLE_STEPS)[number]

export function firstRun(tally: TallyMode | null, projects: number): boolean {
  return tally === null && projects === 0
}
