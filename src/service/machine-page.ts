import type { AccountView } from '../account/model.js'
import type { AccountTie } from '../limits/polls.js'
import { MACHINE_PALETTE } from '../link/colors.js'
import type { MachineRecord } from '../link/hub-store.js'
import { API_VERSION } from '../link/protocol.js'
import type { HubBuild, MachineAbout, MachineAccount, MachineBuildView, MachinePage, MemoryFolderView, TakenFolder } from '../link/view.js'
import type { RemoteMachine } from '../machine/remote.js'
import { fail } from '../notice/notice.js'
import { buildGap, followTarget, type MachineUpdates } from './machine-updates.js'

type PanelEntry = AccountView['accounts'][number]

/** Whether a machine on the link polls `/usage` of the claude.ai account (`AccountPolls.poller`, BTN-991). */
export type Polled = (account: string) => boolean

/** What tells whether a machine's long-token folder gets its limits from anywhere but its sessions (BTN-1266). */
export interface PollsOf {
  /** The machine's whole panel: a `sameAs` folder is looked up in it. */
  panel: PanelEntry[]
  identities: Record<string, AccountTie> | undefined
  polled: Polled
  /** The account's long-token windows differ from its full sign-in's poll (`AccountPolls.differs`, BTN-1267). */
  differs?: Polled
}

/** A long-token folder whose sessions tell other windows than the poll of its account (BTN-1267). */
function limitsDiffer(entry: PanelEntry, polls: PollsOf): boolean {
  const tie = polls.identities?.[entry.key]
  return entry.longToken !== undefined && tie !== undefined && polls.differs?.(tie.account) === true
}

/**
 * A long-token folder whose limits come only from its own sessions (BTN-1266): no machine on the link polls its account,
 * or, with no account known, no folder of its panel on a full sign-in is its `sameAs`.
 */
export function sessionsOnly(entry: PanelEntry, polls: PollsOf): boolean {
  if (entry.longToken === undefined) return false
  const tie = polls.identities?.[entry.key]
  if (tie !== undefined) return !polls.polled(tie.account)
  const same = entry.longToken.sameAs
  return !polls.panel.some((each) => each.key === same && each.longToken === undefined)
}

/** An account of a machine's panel as the hub's page names it: no token, no credentials. */
export function machineAccountOf(entry: PanelEntry, polls?: PollsOf): MachineAccount {
  return {
    key: entry.key,
    agent: entry.agent,
    email: entry.status?.email ?? entry.longToken?.account?.email ?? entry.lastEmail ?? null,
    signedIn: entry.status?.loggedIn === true && !entry.needsLogin,
    ...(entry.longToken !== undefined && { longToken: true as const }),
    ...(polls !== undefined && sessionsOnly(entry, polls) && { sessionsOnly: true as const }),
    ...(polls !== undefined && limitsDiffer(entry, polls) && { limitsDiffer: true as const }),
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
  /** Each machine's palette colour by its place, picked or not. */
  paletteColors: () => Record<string, string>
  taken: (machine: string) => TakenFolder[]
  setCapacity: (machine: string, capacity: number) => Promise<void>
  setColor: (machine: string, color: string | null) => Promise<void>
  /** The own machine's git is the hub's: its name and e-mail as the setup's Git step saves them, and its report read again. */
  ownIdentity: (name: string, email: string) => Promise<void>
  /** A machine elsewhere's: written there by `git.identity`, its report updated with what git read back. */
  setGitIdentity: (machine: string, name: string, email: string) => Promise<void>
  /** The hub's version of Even Keel, named beside a machine's. */
  version: string
  /** What the hub runs, its commit too (BTN-1609); absent — only `version` is compared. */
  hubBuild?: HubBuild
  /** The machines' updates to the hub's build; absent — the page offers no "Update". */
  updates?: Pick<MachineUpdates, 'update' | 'moving'>
  /** Absent — the accounts carry no `sessionsOnly`. */
  polled?: Polled
  /** Absent — the accounts carry no `limitsDiffer`. */
  differs?: Polled
  /** A machine elsewhere's folders bound to projects' memory (BTN-1648); absent — the page has no such card. */
  memory?: {
    of: (machine: string) => MemoryFolderView[]
    /** The hub's projects by id, the only ones a folder binds to. */
    projects: () => string[]
    set: (machine: string, folders: MemoryFolderView[]) => Promise<void>
  }
  log: (line: string) => void
}

/** The bindings as the page sent them, trimmed and once each; a folder left empty or a project not here is refused. */
function checkedFolders(folders: MemoryFolderView[], projects: string[]): MemoryFolderView[] {
  const seen = new Set<string>()
  const result: MemoryFolderView[] = []
  for (const each of folders) {
    if (!projects.includes(each.project)) throw fail('machines.unknownProject', {})
    const folder = typeof each.folder === 'string' ? each.folder.trim() : ''
    if (folder === '') throw fail('request.required', { field: 'folder' })
    const key = `${each.project}\n${folder}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ project: each.project, folder })
  }
  return result
}

/**
 * The report with the CLIs the machine's panel names now (BTN-1502): the report goes only at a handshake, the panel
 * follows a CLI installed or removed since. A machine older than the panel's `clis` keeps its report's.
 */
function withLiveClis(about: MachineAbout | null, clis: Record<string, string | null> | undefined): MachineAbout | null {
  return about === null || clis === undefined ? about : { ...about, agents: { ...about.agents, ...clis } }
}

/** How the machine's build stands to the hub's, for its page (BTN-1609); `undefined` — no gap. */
function buildOf(deps: MachinePageDeps, machine: string, about: MachineAbout, online: boolean): MachineBuildView | undefined {
  const hub = deps.hubBuild ?? { evenKeel: deps.version }
  const gap = buildGap(hub, about)
  if (gap === null) return undefined
  const moving = deps.updates?.moving(machine)
  return {
    gap,
    hub,
    hubApi: API_VERSION,
    update: gap === 'build' && online && deps.updates !== undefined && followTarget(hub, about) !== undefined,
    ...(moving !== undefined && { moving }),
  }
}

/** The page of one machine (`/machines/<id>`, BTN-1272): its query and its commands besides "Revoke". */
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
      const entries = panel?.accounts ?? []
      const polls = deps.polled === undefined ? undefined : { panel: entries, identities: facts?.identities, polled: deps.polled, ...(deps.differs !== undefined && { differs: deps.differs }) }
      const online = own || deps.online(record.id)
      const build = own || record.about === null ? undefined : buildOf(deps, record.id, record.about, online)
      return {
        id: record.id,
        name: record.name,
        own,
        online,
        joinedAt: record.joinedAt,
        about: withLiveClis(own ? await deps.ownAbout() : record.about, panel?.clis),
        hubVersion: deps.version,
        color,
        picked: record.color !== undefined && record.color !== null,
        palette: [...MACHINE_PALETTE],
        paletteColor: deps.paletteColors()[record.id] ?? MACHINE_PALETTE[0]!,
        capacity: own ? deps.parallel() : (record.capacity ?? 1),
        projects: (await deps.folders(record.id)).map((row) => ({
          ...row,
          packagesBlocked: facts?.projects[row.project]?.packagesBlocked === true,
          packagesPause: facts?.projects[row.project]?.packagesPause ?? null,
        })),
        accounts: entries.map((entry) => ({ ...machineAccountOf(entry, polls), limits: mirror?.page.limits(entry.key) ?? null })),
        missing: panel?.missing ?? [],
        sessions: (mirror?.page.sessions() ?? [])
          .filter((view) => view.lamp !== 'finished')
          .map(({ task, sessionId, agent, model, lamp, cwd }) => ({ task, sessionId, agent, model, lamp, cwd })),
        taken: deps.taken(record.id),
        ...(build !== undefined && { build }),
        ...(!own && deps.memory !== undefined && { memory: deps.memory.of(record.id) }),
      }
    },
    /**
     * "Update" (BTN-1609): the machine comes to the hub's build once its lanes settle, a target it failed at too. The
     * answer comes at once; the settle and the machine's answer go to the log and the event log.
     */
    async update(machine: string): Promise<void> {
      const record = await known(machine)
      if (record.id === deps.own() || record.about === null || deps.updates === undefined) throw fail('machines.noUpdate', { name: record.name })
      if (!deps.online(record.id)) throw fail('machines.offline', { name: record.name })
      void deps.updates.update(record.id, record.about).catch((error: unknown) => deps.log(`machines: "Update" of machine ${record.id} failed: ${String(error)}`))
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
    /** Git's `user.name` and `user.email` on the machine (BTN-1503): `git config --global` there, its facts at once. */
    async gitIdentity(machine: string, name: string, email: string): Promise<void> {
      const record = await known(machine)
      if (record.id === deps.own()) return deps.ownIdentity(name, email)
      return deps.setGitIdentity(record.id, name, email)
    },
    /**
     * The machine's folders bound to projects' memory, the whole list (BTN-1648): it syncs them beyond its pool and gets
     * their repositories over the link. The own machine's folders are the hub's copies already.
     */
    async memoryFolders(machine: string, folders: MemoryFolderView[]): Promise<void> {
      const record = await known(machine)
      if (record.id === deps.own() || deps.memory === undefined) throw fail('machines.memoryOwn', {})
      if (!Array.isArray(folders)) throw fail('request.required', { field: 'folders' })
      await deps.memory.set(record.id, checkedFolders(folders, deps.memory.projects()))
    },
  }
}

export type MachinePageControl = ReturnType<typeof machinePageControl>
