import type { HulyTask } from '../../src/huly/model.js'
import type { BatonState } from '../../src/state.js'

export function projectTasks(state: BatonState, project: string): HulyTask[] {
  return state.tasks.filter((task) => task.id.startsWith(`${project}-`))
}
