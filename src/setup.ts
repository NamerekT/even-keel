import type { TallyMode } from './stats/mode.js'

/**
 * The first run (BTN-310): the stats are not chosen and there is no project yet. The page walks its setup (`/setup`),
 * whose last setting is the stats, and the service asks GitHub for no release meanwhile: the setup asks whether to.
 */
export function firstRun(tally: TallyMode | null, projects: number): boolean {
  return tally === null && projects === 0
}
