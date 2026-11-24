import type { Queryable } from '../../storage/database.js'
import { setStateValue, stateValue } from '../../storage/service-state.js'

/** A folder of a project on a machine outside the project's pool, bound to its memory by the hub's owner (BTN-1648). */
export interface MemoryFolder {
  project: string
  /** The project's folder on the machine, as its memory folder's name is made of it (`sharedMemory`). */
  folder: string
}

/**
 * The bindings of folders to project memory, by machine (`memory.folders` in `service_state`): what a machine syncs
 * beyond its pool, and what gives it the right to the project's repository over the link. Read once by `load`, kept
 * here; a change is written at once.
 */
export class MemoryFolders {
  private byMachine: Record<string, MemoryFolder[]> = {}

  constructor(private readonly db: Queryable) {}

  async load(): Promise<void> {
    const value = await stateValue(this.db, 'memory.folders')
    this.byMachine = isBindings(value) ? value : {}
  }

  of(machine: string): MemoryFolder[] {
    return this.byMachine[machine] ?? []
  }

  allows(machine: string, project: string): boolean {
    return this.of(machine).some((each) => each.project === project)
  }

  async set(machine: string, folders: MemoryFolder[]): Promise<void> {
    const next = { ...this.byMachine }
    if (folders.length === 0) delete next[machine]
    else next[machine] = folders.map(({ project, folder }) => ({ project, folder }))
    await setStateValue(this.db, 'memory.folders', next)
    this.byMachine = next
  }
}

function isBindings(value: unknown): value is Record<string, MemoryFolder[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every((list) => Array.isArray(list) && list.every((each) => typeof each?.project === 'string' && typeof each?.folder === 'string'))
}
