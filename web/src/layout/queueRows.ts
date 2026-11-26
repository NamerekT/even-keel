import type { EvenKeelState } from '../../../src/state.js'
import { lanesOf } from '../lanes.js'
import { cardTask, type CardTask } from '../state.js'

/** The running projects, each once: `chain.active` holds a record a lane (BTN-1730). */
export function activeProjects(chain: EvenKeelState['chain']): string[] {
  return [...new Set(chain.active.map((lane) => lane.project))]
}

/** The header button's lamp: paused only when every lane is. */
export function chainKind(chain: EvenKeelState['chain']): 'idle' | 'paused' | 'running' {
  if (chain.active.length === 0) return 'idle'
  return chain.active.every((lane) => lane.paused) ? 'paused' : 'running'
}

export interface QueueRow {
  project: string
  tasks: CardTask[]
}

/** A row a running project with the current task of each of its lanes; lanes holding none show the project's next task once. */
export function queueRows(state: EvenKeelState): QueueRow[] {
  return activeProjects(state.chain).map((project) => {
    const held = lanesOf(state.chain, project).filter((lane) => lane.current !== null)
    const tasks = held.length === 0 ? [cardTask(state, project)] : held.map((lane) => cardTask(state, project, lane))
    const shown = new Map<string, CardTask>()
    for (const task of tasks) if (task !== null && !shown.has(task.id)) shown.set(task.id, task)
    return { project, tasks: [...shown.values()] }
  })
}
