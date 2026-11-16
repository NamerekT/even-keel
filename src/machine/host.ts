import type { DispatcherDeps } from '../chain/model.js'

/**
 * What the machine's side of a task takes from the hub besides the port itself. `save`, `journal` and `moveStatus`
 * become the machine's events with the link, `blocked` stays the hub's launch decision; until then the machine's code
 * changes the chain's records in place and saves them through these (`docs/machines.md`, "The seam").
 */
export type MachineTaskDeps = Pick<DispatcherDeps,
  | 'machine' | 'save' | 'journal' | 'moveStatus' | 'now' | 'log'
  | 'blocked' | 'promptLanguage' | 'mainBranch' | 'pullRequests' | 'plain'
>
