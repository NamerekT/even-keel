import type { AccountView } from '../account/model.js'
import { MACHINE_PALETTE } from '../link/colors.js'
import type { MachineRecord } from '../link/hub-store.js'
import type { MachineAbout, MachineAccount, MachinePage, TakenFolder } from '../link/view.js'
import type { RemoteMachine } from '../machine/remote.js'
import { fail } from '../notice/notice.js'

/** An account of a machine's panel as the hub's page names it: no token, no credentials. */
export function machineAccountOf(entry: AccountView['accounts'][number]): MachineAccount {
  return {
    key: entry.key,
    agent: entry.agent,
    email: entry.status?.email ?? entry.longToken?.account?.email ?? entry.lastEmail ?? null,
    signedIn: entry.status?.loggedIn === true && !entry.needsLogin,
    ...(entry.longToken !== undefined && { longToken: true as const }),
  }
}

export interface MachinePageDeps {
  own: () => string
  record: (machine: string) => Promise<MachineRecord | undefined>
  online: (machine: string) => boolean
  /** The hub's mirror of the machine; `undefined` — it has not posted a snapshot since the hub started. */
  mirror: (machine: string) => Pick<RemoteMachine, 'facts' | 'page'> | undefined
  /** The own machine's report, read once (the agents' `--version` take seconds). */
  ownAbout: () => Promise<MachineAbout>
  /** `parallel`: the own machine's capacity. */
  parallel: () => number
  setParallel: (count: number) => void
  folders: (machine: string) => Promise<Array<{ project: string; folder: string; enabled: boolean }>>
  colors: () => Record<string, string>
  taken: (machine: string) => TakenFolder[]
  setCapacity: (machine: string, capacity: number) => Promise<void>
  setColor: (machine: string, color: string | null) => Promise<void>
  log: (line: string) => void
}

/** The page of one machine (`/machines/<id>`, BTN-1272): its query and its two commands besides "Revoke". */
export function machinePageControl(deps: MachinePageDeps) {
  const known = async (machine: string): Promise<MachineRecord> => {
    const record = await deps.record(machine)
    if (record === undefined || record.revokedAt !== null) throw fail('machines.unknown', {})
    return record
  }
  return {
    async view(machine: string): Promise<MachinePage> {
      const record = await known(machine)
      const own = record.id === deps.own()
      const mirror = deps.mirror(record.id)
      const facts = mirror?.facts()
      const panel = mirror?.page.panel()
      const color = deps.colors()[record.id] ?? MACHINE_PALETTE[0]!
      return {
        id: record.id,
        name: record.name,
        own,
        online: own || deps.online(record.id),
        joinedAt: record.joinedAt,
        about: own ? await deps.ownAbout() : record.about,
        color,
        picked: record.color !== undefined && record.color !== null,
        palette: [...MACHINE_PALETTE],
        capacity: own ? deps.parallel() : (record.capacity ?? 1),
        projects: (await deps.folders(record.id)).map((row) => ({
          ...row,
          packagesBlocked: facts?.projects[row.project]?.packagesBlocked === true,
          packagesPause: facts?.projects[row.project]?.packagesPause ?? null,
        })),
        accounts: (panel?.accounts ?? []).map((entry) => ({ ...machineAccountOf(entry), limits: mirror?.page.limits(entry.key) ?? null })),
        missing: panel?.missing ?? [],
        sessions: (mirror?.page.sessions() ?? [])
          .filter((view) => view.lamp !== 'finished')
          .map(({ task, sessionId, agent, model, lamp, cwd }) => ({ task, sessionId, agent, model, lamp, cwd })),
        taken: deps.taken(record.id),
      }
    },
    /** The own machine's is `parallel`; a machine elsewhere's applies at once, without waiting for its next snapshot. */
    async capacity(machine: string, capacity: number): Promise<void> {
      if (!Number.isInteger(capacity) || capacity < 1) throw fail('request.required', { field: 'capacity' })
      const record = await known(machine)
      if (record.id !== deps.own()) return deps.setCapacity(record.id, capacity)
      deps.setParallel(capacity)
      deps.log(`machines: the own machine runs ${capacity} of the hub's task(s) at once (parallel)`)
    },
    color: (machine: string, color: string | null) => deps.setColor(machine, color),
  }
}

export type MachinePageControl = ReturnType<typeof machinePageControl>
