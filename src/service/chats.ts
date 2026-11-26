import type { AccountView } from '../account/model.js'
import { ProjectChats } from '../chats/chats.js'
import type { ChatMachines } from '../chats/model.js'
import { pickedOf, placeOf, placesOf, type ChatPlaceDeps } from '../chats/places.js'
import { ChatStore } from '../chats/store.js'
import type { ServiceContext } from '../service.js'

type ChatsContext = Pick<ServiceContext, 'configStore' | 'db' | 'machineLink' | 'promptLanguage' | 'stateChanged' | 'writes'>

/** How often the chats keep what their sessions said and the day-old ones go to the archive. */
export const CHATS_SWEEP_MS = 60_000

/**
 * The project chats on the hub (BTN-1230, `docs/sessions/project-chats.md`): their store and the machine of each chat —
 * the one the "New session" window named (BTN-1614), else the own one when the project's pool has it or is empty, else
 * the first connected machine of it.
 */
export async function wireProjectChats(ctx: ChatsContext): Promise<ProjectChats> {
  const link = ctx.machineLink
  const store = await ChatStore.open({ db: ctx.db, writes: ctx.writes })
  const places: ChatPlaceDeps = {
    repo: (project) => ctx.configStore.current.projects[project],
    own: () => link.own(),
    pool: (project) => link.network.poolOf(project),
    live: () => link.network.live(),
    connected: (machine) => link.network.connected(machine),
    folderOf: async (machine, project) => (await link.network.foldersOf(machine)).find((entry) => entry.project === project)?.folder,
  }
  /** A machine elsewhere's accounts panel as its mirror has it, each folder with the limits the hub keeps for it. */
  const panelOf = (machine: string): AccountView | null => {
    const page = link.mirror(machine)?.page
    const panel = page?.panel()
    if (page === undefined || panel === undefined) return null
    return { ...panel, accounts: panel.accounts.map((entry) => ({ ...entry, limits: page.limits(entry.key) })) }
  }
  const machines = async (project: string): Promise<ChatMachines> => {
    const options = await placesOf(places, project)
    const own = link.own()
    const names = link.network.names()
    return {
      picked: pickedOf(options),
      machines: options.map((option) => ({
        id: option.machine,
        name: names[option.machine] ?? option.machine,
        own: option.machine === own,
        block: option.block,
        accounts: option.machine === own ? null : panelOf(option.machine),
      })),
    }
  }
  return new ProjectChats({
    store,
    placeOf: (project, machine) => placeOf(places, project, machine),
    machines,
    services: (machine) => (machine === link.own() ? link.services : link.mirror(machine)?.services()),
    sessions: (machine) => link.mirror(machine)?.page.sessions() ?? [],
    machineName: (machine) => link.network.names()[machine] ?? machine,
    accounts: (machine) => link.mirror(machine)?.page.panel()?.accounts.map((entry) => ({ key: entry.key, agent: entry.agent })),
    language: (project) => ctx.promptLanguage(project),
    changed: () => ctx.stateChanged(),
    log: (line) => console.log(line),
    now: () => new Date(),
    ceiling: () => ctx.configStore.current.chatSessions,
  })
}
