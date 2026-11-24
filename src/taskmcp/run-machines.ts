import { EditRefused } from '../tracker/editor.js'
import { taskRunText, type RunPatch, type TaskRun } from '../sessions/runs.js'

/** A machine of a project's pool as the tasks tools name it (BTN-1623). */
export interface PoolMachine {
  id: string
  name: string
}

/**
 * The patch with its `machines` named by id (`docs/machines.md`, "A task pinned to machines"): each given name or id is
 * a machine of the pool, the name in any case; another is refused with the pool's names. An empty list clears the pin.
 */
export function pinnedPatch(patch: RunPatch, pool: readonly PoolMachine[]): RunPatch {
  if (patch.machines === undefined || patch.machines === null) return patch
  if (patch.machines.length === 0) return { ...patch, machines: null }
  const ids = patch.machines.map((given) => {
    const wanted = given.trim()
    const found = pool.find((each) => each.id === wanted) ?? pool.find((each) => each.name.toLowerCase() === wanted.toLowerCase())
    if (found !== undefined) return found.id
    const names = pool.map((each) => each.name).join(', ')
    throw new EditRefused(`"${wanted}" is no machine of the project's pool${names === '' ? '' : ` (${names})`}`)
  })
  return { ...patch, machines: [...new Set(ids)] }
}

/** The run in a line of the card's head: provider, model, effort and the machines it is pinned to, by name. */
export function runLine(run: TaskRun, names: (id: string) => string): string {
  const pins = run.machines === undefined || run.machines.length === 0 ? [] : [`machines ${run.machines.map(names).join(', ')}`]
  return [taskRunText(run), ...pins].filter((part) => part !== '').join(' · ')
}
