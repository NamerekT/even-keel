import type { OutsideTask } from '../state.js'
import type { TrackerLink } from '../tracker/link.js'
import { isOpen } from '../tracker/model.js'
import { withMilestoneOrder } from './milestone-sequence.js'
import { outsideReason, type ChainRules } from './rules.js'

export interface OutsideDeps {
  /** The project's readers in order: the project, then its feeds. */
  readers: (project: string) => string[]
  linkOf: (reader: string) => Pick<TrackerLink, 'run'> | undefined
  rulesOf: (reader: string) => ChainRules
  /** The project's saved milestone order. */
  milestoneOrder: (project: string) => readonly string[]
}

/**
 * `outside/tasks` (BTN-1428): the project's open tasks without subtasks that neither the chain nor the backlog takes, with
 * the reason. The regular read leaves them out — a milestone the rules leave out is not read as the project's, a status
 * the rules count as closed is not read as open — so each reader is read anew by the tracker's status categories alone
 * and judged by its own rules. Open is the tracker's category here: a canceled task is never one of them.
 */
export async function outsideTasks(deps: OutsideDeps, project: string): Promise<OutsideTask[]> {
  const found: OutsideTask[] = []
  for (const reader of deps.readers(project)) {
    const link = deps.linkOf(reader)
    if (link === undefined) continue
    const rules = deps.rulesOf(reader)
    const read = await link.run((tracker) => tracker.chainTasks(reader, { ...rules, active: null, terminal: null }))
    for (const task of read.tasks) {
      if (!isOpen(task.status) || found.some((each) => each.task.id === task.id)) continue
      const why = outsideReason(rules, task)
      if (why !== null) found.push({ task, ...why })
    }
  }
  const ranked = withMilestoneOrder(
    found.map((each) => each.task),
    deps.milestoneOrder(project),
  )
  return found.map((each, index) => ({ ...each, task: ranked[index]! }))
}
