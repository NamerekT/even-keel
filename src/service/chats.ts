import { ProjectChats, type ChatPlace } from '../chats/chats.js'
import { ChatStore } from '../chats/store.js'
import { fail } from '../notice/notice.js'
import type { ServiceContext } from '../service.js'

type ChatsContext = Pick<ServiceContext, 'configStore' | 'db' | 'machineLink' | 'promptLanguage' | 'stateChanged' | 'writes'>

/** How often the chats keep what their sessions said and the day-old ones go to the archive. */
export const CHATS_SWEEP_MS = 60_000

/**
 * The project chats on the hub (BTN-1230, `docs/sessions/project-chats.md`): their store and the machine of each
 * project's folder — the own one when the project's pool has it or is empty, else the first connected machine of it.
 */
export async function wireProjectChats(ctx: ChatsContext): Promise<ProjectChats> {
  const link = ctx.machineLink
  const store = await ChatStore.open({ db: ctx.db, writes: ctx.writes })
  const placeOf = async (project: string): Promise<ChatPlace> => {
    const repo = ctx.configStore.current.projects[project]
    if (repo === undefined) throw fail('chain.unknownProject', { project })
    const own = link.own()
    const pool = link.network.poolOf(project)
    if (pool.length === 0 || pool.includes(own)) return { machine: own, folder: repo }
    for (const machine of pool) {
      if (!link.network.connected(machine)) continue
      const folder = (await link.network.foldersOf(machine)).find((entry) => entry.project === project)?.folder
      if (folder !== undefined) return { machine, folder }
    }
    throw fail('chats.noMachine', {})
  }
  return new ProjectChats({
    store,
    placeOf,
    services: (machine) => (machine === link.own() ? link.services : link.mirror(machine)?.services()),
    sessions: (machine) => link.mirror(machine)?.page.sessions() ?? [],
    accounts: (machine) => link.mirror(machine)?.page.panel()?.accounts.map((entry) => ({ key: entry.key, agent: entry.agent })),
    language: (project) => ctx.promptLanguage(project),
    changed: () => ctx.stateChanged(),
    log: (line) => console.log(line),
    now: () => new Date(),
  })
}
