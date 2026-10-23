import { isLaunch } from '../../src/chain/launches.js'
import type { LaunchEntry } from '../../src/chain/model.js'
import type { ClosedTask } from '../../src/chain/store.js'

/** What Tally's `tasks` learns of a task of another tracker than Huly from Even Keel's archive (BTN-330). */
export interface ClosedState {
  task: string
  /** The status the tracker last gave; `null` — not kept, or the task is open again. */
  status: string | null
  done: boolean
}

/**
 * The tasks of another tracker the chain saw closed (`closed_tasks`), by their latest close across projects: done with
 * the status of that close, or open without a status when the chain launched the task again after it. Huly tasks are
 * left to Huly, which Tally asks itself.
 */
export function closedStates(closed: ClosedTask[], launches: LaunchEntry[]): ClosedState[] {
  const latest = new Map<string, ClosedTask>()
  for (const each of closed) {
    if (each.tracker === 'huly') continue
    const known = latest.get(each.task)
    if (known === undefined || Date.parse(each.closedAt) > Date.parse(known.closedAt)) latest.set(each.task, each)
  }
  const launched = new Map<string, number>()
  for (const entry of launches) {
    if (!latest.has(entry.task) || !isLaunch(entry)) continue
    launched.set(entry.task, Math.max(launched.get(entry.task) ?? 0, Date.parse(entry.at)))
  }
  return [...latest.values()].map((each) =>
    (launched.get(each.task) ?? 0) > Date.parse(each.closedAt)
      ? { task: each.task, status: null, done: false }
      : { task: each.task, status: each.status, done: true },
  )
}
