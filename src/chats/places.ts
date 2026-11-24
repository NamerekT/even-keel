import { fail } from '../notice/notice.js'
import type { ChatMachineBlock } from './model.js'

/** Where a project's folder is: its machine and the folder there. */
export interface ChatPlace {
  machine: string
  folder: string
}

/** A machine a project chat may run on, and why it cannot now; `folder` — the project's folder there, `null` — none. */
export interface ChatPlaceOption {
  machine: string
  folder: string | null
  block: ChatMachineBlock | null
}

export interface ChatPlaceDeps {
  /** The project's main checkout on the own machine; `undefined` — no such project. */
  repo: (project: string) => string | undefined
  own: () => string
  /** The machines of the project's pool, turned on. */
  pool: (project: string) => readonly string[]
  /** The machines the hub has now, the own one first. */
  live: () => readonly string[]
  connected: (machine: string) => boolean
  /** The project's folder on a machine elsewhere; `undefined` — it has none. */
  folderOf: (machine: string, project: string) => Promise<string | undefined>
}

/**
 * The machines a chat of the project may run on (BTN-1614, `docs/sessions/project-chats.md`, "The machine"): the pool's,
 * the own one first; with no pool, the own one and the machines elsewhere that have a folder of the project.
 */
export async function placesOf(deps: ChatPlaceDeps, project: string): Promise<ChatPlaceOption[]> {
  const repo = deps.repo(project)
  if (repo === undefined) throw fail('chain.unknownProject', { project })
  const own = deps.own()
  const pool = deps.pool(project)
  const elsewhere = (pool.length === 0 ? deps.live() : pool).filter((machine) => machine !== own)
  const options: ChatPlaceOption[] = pool.length === 0 || pool.includes(own) ? [{ machine: own, folder: repo, block: null }] : []
  for (const machine of elsewhere) {
    const folder = (await deps.folderOf(machine, project)) ?? null
    if (folder === null && pool.length === 0) continue
    const block = !deps.connected(machine) ? 'offline' : folder === null ? 'noFolder' : null
    options.push({ machine, folder, block })
  }
  return options
}

/** The machine a new chat goes to when the page names none: the own one when it may, else the first one that can. */
export const pickedOf = (options: readonly ChatPlaceOption[]): string | null => options.find((option) => option.block === null)?.machine ?? null

/**
 * The place of a chat of the project: on `machine` when named, which must be one of `placesOf` and able to take it, else
 * on `pickedOf`. Throws a notice.
 */
export async function placeOf(deps: ChatPlaceDeps, project: string, machine?: string): Promise<ChatPlace> {
  const options = await placesOf(deps, project)
  const option = machine === undefined ? options.find((each) => each.machine === pickedOf(options)) : options.find((each) => each.machine === machine)
  if (option === undefined) throw fail(machine === undefined ? 'chats.noMachine' : 'chats.notInPool', {})
  if (option.block === 'offline') throw fail('chats.noMachine', {})
  if (option.block === 'noFolder' || option.folder === null) throw fail('chats.noFolder', {})
  return { machine: option.machine, folder: option.folder }
}
