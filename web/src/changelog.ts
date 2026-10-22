import type { EvenKeelState, ProjectTask } from '../../src/state.js'
import { projectTasks } from './state.js'

/** The done tasks of the project's milestone that `accounted` lacks — what "add" gives the agent. */
export function unaccounted(tasks: ProjectTask[], project: string, milestone: string, accounted: readonly string[]): string[] {
  const known = new Set(accounted)
  return projectTasks({ tasks }, project)
    .filter((task) => task.milestone?.label === milestone && task.status.category === 'Won' && !known.has(task.id))
    .map((task) => task.id)
}

/** How many of the milestone's done tasks closed after its changelog was last written; `null` — it never was. */
export function sinceWritten(state: Pick<EvenKeelState, 'tasks' | 'changelogs'>, project: string, milestone: string): number | null {
  const written = state.changelogs[project]?.[milestone]
  return written === undefined ? null : unaccounted(state.tasks, project, milestone, written).length
}
