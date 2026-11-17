import { notice } from '../../../src/notice/notice.js'
import { MACHINE_PALETTE, machineColors } from '../../../src/link/colors.js'
import { JOIN_KIND, type JoinRequest } from '../../../src/jobs/model.js'
import type { EvenKeelState, JobStep, MachineAbout, MachineCard, MachineInvite, MachinePage, MachineProject, MachineSignIn, MachineView, PoolMachine, ProjectPool, StepJob } from '../../../src/state.js'

/** A string issued in `dev:fake` is joined with this much later (BTN-1056). */
const JOIN_MS = 3_000
const INVITE_MS = 30 * 60_000

const about = (host: string, patch: Partial<MachineAbout> = {}): MachineAbout => ({
  host, os: 'linux 6.8.0', evenKeel: '0.4.0', node: '24.11.0', git: '2.47.0', agents: { claude: '2.1.322' }, gitUser: true, root: '/home/example/projects', ...patch,
})

/**
 * The machines elsewhere of `dev:fake` for the window that adds one (BTN-1056): with `?machines=…` the two of
 * `fakeMachineSignIns` are joined already (`?addMachine=machine-1` opens the laptop's step); a string issued joins
 * `JOIN_MS` later as a server named by its host when no name was given.
 */
export class FakeNetwork {
  private machines: MachineView[] = []
  private readonly listeners = new Set<() => void>()
  /** The pools of the projects (BTN-1271), by project: the own machine's row comes in on the first read. */
  private readonly pools = new Map<string, PoolMachine[]>()

  /** `repoOf` — a project's folder here, the own machine's row of its pool. */
  constructor(private readonly mode: string | null, private readonly repoOf: (project: string) => string = () => '') {
    if (mode === null) return
    const joined = (id: string, name: string, report: MachineAbout, online: boolean): MachineView => ({
      id, name, createdAt: Date.now() - 86_400_000, revokedAt: null, inviteExpires: null, joinedAt: Date.now() - 86_000_000, host: report.host, about: report, online, projects: [], taken: [],
    })
    this.machines = [
      joined('machine-1', 'Example laptop', about('example-laptop', mode === 'nocli' ? { agents: {} } : { gitUser: false }), mode !== 'offline'),
      joined('machine-2', 'Example desktop', about('example-desktop', { os: 'win32 10.0.26200', agents: { claude: '2.1.322', codex: '0.98.0' } }), true),
    ]
  }

  on(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The answer of a machines query; `undefined` — not one of them. */
  query(name: string, body: Record<string, unknown>): unknown {
    if (name === 'machines/list') return this.machines.map((machine) => ({ ...machine }))
    if (name === 'machines/pool') return this.poolOf(String(body.project))
    if (name !== 'machines/invite') return undefined
    const id = `machine-${this.machines.length + 1}`
    const given = String(body.name ?? '').trim()
    this.machines = this.machines.filter((machine) => machine.joinedAt !== null)
    this.machines.push({ id, name: given, createdAt: Date.now(), revokedAt: null, inviteExpires: Date.now() + INVITE_MS, joinedAt: null, host: null, about: null, online: false, projects: [], taken: [] })
    if (typeof body.color === 'string') this.colors.set(id, body.color)
    setTimeout(() => {
      const report = about('example-server', { agents: { claude: '2.1.322' } })
      this.machines = this.machines.map((machine) =>
        machine.id === id ? { ...machine, name: machine.name || report.host, joinedAt: Date.now(), inviteExpires: null, host: report.host, about: report, online: true } : machine,
      )
      for (const listener of this.listeners) listener()
    }, JOIN_MS)
    const line = `ek1_${btoa(id).replace(/=+$/, '')}example`
    return { line, machine: id, expiresAt: Date.now() + INVITE_MS, command: `npx even-keel@0.4.0 install --machine ${line}` } satisfies MachineInvite
  }

  private rows(project: string): PoolMachine[] {
    const rows = this.pools.get(project) ?? [{ id: OWN, name: OWN_NAME, own: true, online: true, folder: this.repoOf(project), enabled: true }]
    this.pools.set(project, rows)
    return rows
  }

  private poolOf(project: string): ProjectPool {
    const machines = this.rows(project)
    const others = this.machines
      .filter((machine) => machine.joinedAt !== null && machine.revokedAt === null && !machines.some((row) => row.id === machine.id))
      .map((machine) => ({ id: machine.id, name: machine.name, own: false, online: machine.online, folder: `${machine.about?.root ?? '/home/example/projects'}/${folderName(this.repoOf(project))}` }))
    return { machines: machines.map((row) => ({ ...row })), others }
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  /** The colours picked on the machines' pages and their capacities (BTN-1272), by machine. */
  private readonly colors = new Map<string, string | null>()
  private readonly capacities = new Map<string, number>()

  /** Each machine of `names` with its colour, the picked one or the palette's by its place. */
  colorsOf(names: Record<string, string>): Record<string, string> {
    return machineColors(Object.keys(names).map((id) => ({ id, color: this.colors.get(id) ?? null })))
  }

  /**
   * The header panel's cards of the state's machines (BTN-1051), one lamp of each kind: the own one runs every
   * project; the laptop has git without a name (`?machines=nocli` — with one), off the link two hours ago with
   * `?machines=offline`; the desktop's Claude accounts are at a limit till 18:40 with `?machines=limit`.
   */
  cards(state: EvenKeelState): MachineCard[] {
    const names = state.machineNames ?? {}
    const colors = this.colorsOf(names)
    const own = state.ownMachine ?? OWN
    const until = new Date()
    until.setHours(18, 40, 0, 0)
    if (until.getTime() < Date.now()) until.setDate(until.getDate() + 1)
    const ids = [own, ...Object.keys(names).filter((id) => id !== own)]
    return ids.map((id): MachineCard => {
      const online = id === own || (this.machines.find((machine) => machine.id === id)?.online ?? true)
      // A card lists only the projects whose pool has the machine, as the server's does; the first project has every one.
      const pooled = state.projects
        .map((project, index) => {
          const row = this.pools.get(project)?.find((each) => each.id === id)
          const always = id === own || index === 0 || id === 'srv'
          return { project, member: always || row !== undefined, enabled: always || row?.enabled === true, packagesBlocked: false }
        })
        .filter((each) => each.member)
        .map(({ project, enabled, packagesBlocked }) => ({ project, enabled, packagesBlocked }))
      return {
        id, name: names[id] ?? id, color: colors[id]!, own: id === own, online,
        offlineSince: online ? null : Date.now() - 2 * 3_600_000,
        gitUser: id === 'machine-1' ? this.mode === 'nocli' : true,
        agents: id === own || id === 'machine-2' ? ['claude', 'codex'] : ['claude'],
        limitedUntil: id === 'machine-2' && this.mode === 'limit' ? { claude: until.toISOString() } : {},
        projects: pooled,
        ...this.cardAccounts(state, id, id === own, until),
      }
    })
  }

  /** The own machine's are the state's; the laptop is signed out of the second; the desktop's Claude is spent with `limit`. */
  private cardAccounts(state: EvenKeelState, id: string, own: boolean, until: Date): Pick<MachineCard, 'accounts' | 'active'> {
    const spent = { fiveHour: { usedPercentage: 100, resetsAt: until.toISOString() }, sevenDay: null, updatedAt: new Date().toISOString(), source: 'usage' } as unknown as NonNullable<EvenKeelState['limits']>
    const accounts = state.account.accounts.map((entry, index) => {
      const signedIn = own ? entry.status?.loggedIn === true : !(id === 'machine-1' && index > 0)
      const limits = own ? entry.limits : !signedIn ? null : id === 'machine-2' && this.mode === 'limit' && entry.agent === 'claude' ? spent : state.limits
      return { key: entry.key, agent: entry.agent, email: entry.status?.email ?? null, name: entry.name, signedIn, limits }
    })
    return { accounts, active: state.account.active }
  }

  /**
   * The page of a machine of the state's `machineNames` (BTN-1272): the own one reports Windows and runs the state's
   * sessions; the laptop is not signed in to the second account and the first project's packages are not ready there.
   */
  page(id: string, state: EvenKeelState): MachinePage | undefined {
    const names = state.machineNames ?? {}
    const name = names[id]
    if (name === undefined) return undefined
    const own = id === OWN
    const view = this.machines.find((machine) => machine.id === id)
    const report = own ? about('workstation', { os: 'win32 10.0.26200', root: null, agents: { claude: '2.1.322', codex: '0.98.0' } }) : (view?.about ?? about(name.toLowerCase().replace(/\W+/g, '-')))
    const pooled = state.projects.filter((project) => own || this.pools.get(project)?.some((row) => row.id === id) || view?.projects.includes(project) || project === state.projects[0])
    const projects: MachineProject[] = pooled.map((project, index) => {
      const row = (own ? this.rows(project) : this.pools.get(project))?.find((each) => each.id === id)
      return {
        project,
        folder: row?.folder ?? `${report.root ?? '/home/example/projects'}/${folderName(this.repoOf(project))}`,
        enabled: row?.enabled ?? true,
        packagesBlocked: id === 'machine-1' && index === 0,
        packagesPause: null,
      }
    })
    const color = this.colors.get(id) ?? null
    return {
      id,
      name,
      own,
      online: own || (view?.online ?? true),
      joinedAt: own ? null : (view?.joinedAt ?? Date.now() - 86_000_000),
      about: report,
      color: this.colorsOf(names)[id]!,
      picked: color !== null,
      palette: [...MACHINE_PALETTE],
      capacity: this.capacities.get(id) ?? (own ? state.chain.parallel : 1),
      projects,
      accounts: state.account.accounts.map((entry, index) => {
        const signedIn = own ? entry.status?.loggedIn === true : !(id === 'machine-1' && index > 0)
        return { key: entry.key, agent: entry.agent, email: entry.status?.email ?? null, signedIn, limits: signedIn ? state.limits : null }
      }),
      missing: [],
      sessions: own ? state.sessions.filter((session) => session.lamp !== 'finished').map(({ task, sessionId, agent, model, lamp, cwd }) => ({ task, sessionId, agent, model, lamp, cwd })) : [],
      taken: [],
    }
  }

  /**
   * The machines' commands; `false` — another command, or one whose job is the state's. `machines/connect` puts the machine into the
   * pool turned off and answers `false` too: its job is the state's, `fakeMachineCommand`.
   */
  command(name: string, body: Record<string, unknown>): boolean {
    if (name === 'machines/capacity') {
      this.capacities.set(String(body.machine), Number(body.capacity))
      this.changed()
      return true
    }
    if (name === 'machines/color') {
      this.colors.set(String(body.machine), typeof body.color === 'string' ? body.color : null)
      this.changed()
      return true
    }
    if (name === 'machines/enable') {
      const project = String(body.project)
      this.pools.set(project, this.rows(project).map((row) => (row.id === body.machine ? { ...row, enabled: body.enabled === true } : row)))
      this.changed()
      return true
    }
    if (name === 'machines/connect') {
      const project = String(body.project)
      const machine = this.machines.find((each) => each.id === body.machine)
      const rows = this.rows(project)
      if (machine !== undefined && !rows.some((row) => row.id === machine.id)) {
        const folder = String(body.folder ?? '').trim() || this.poolOf(project).others.find((each) => each.id === machine.id)?.folder || ''
        // The fake's job fails on the laptop's push check: there the row stays off; elsewhere it is turned on.
        rows.push({ id: machine.id, name: machine.name, own: false, online: machine.online, folder, enabled: machine.id !== 'machine-1' })
      }
      this.changed()
      return false
    }
    if (name !== 'machines/join') return false
    // Its job is the state's (`fakeMachineCommand`); the projects the job connects show on the machine at once.
    const requests = (body.projects as JoinRequest[] | undefined) ?? []
    const failing = joinFailing(String(body.machine), requests)
    const projects = requests.map((each) => each.project).filter((project) => project !== failing)
    this.machines = this.machines.map((machine) => (machine.id === body.machine ? { ...machine, projects: [...new Set([...machine.projects, ...projects])] } : machine))
    this.changed()
    return false
  }
}

/** The hub's own machine in `dev:fake`, as `?machines=…` names it in `machineNames`. */
const OWN = 'pc'
const OWN_NAME = 'Workstation'

/** The machine names of `?machines=…`: the hub's own and the two machines elsewhere, so the project's "Machines" shows. */
export const FAKE_MACHINE_NAMES: Record<string, string> = { [OWN]: OWN_NAME, 'machine-1': 'Example laptop', 'machine-2': 'Example desktop' }

/** The state's machine colours and own machine where `dev:fake` has several machines (BTN-1272): the palette's, `pc` own. */
export const fakeMachineColors = (names: Record<string, string>): Pick<EvenKeelState, 'machineColors' | 'ownMachine'> => ({
  machineColors: machineColors(Object.keys(names).map((id) => ({ id }))),
  ownMachine: OWN,
})

const folderName = (path: string): string => path.split(/[\\/]/).filter((part) => part !== '').pop() ?? 'project'

const CONNECT_CHECKS = ['repo', 'remote', 'branch', 'trust', 'packages', 'push'].map((step) => `machine-${step}`)

/**
 * The job "Connect" starts (BTN-1271): done at once, except on the laptop, whose push check fails with what to do.
 */
function connectJob(state: EvenKeelState, body: Record<string, unknown>): StepJob {
  const machine = String(body.machine)
  const ids = [...(body.clone === true ? ['machine-clone'] : []), 'machine-place', ...CONNECT_CHECKS, 'machine-enable']
  const failing = machine === 'machine-1' ? ids.indexOf('machine-push') : -1
  const at = new Date().toISOString()
  const steps: JobStep[] = ids.map((id, index) =>
    failing === -1 || index < failing ? { id, state: 'done', startedAt: at, endedAt: at } : index === failing ? { id, state: 'failed', startedAt: at, endedAt: at } : { id, state: 'waiting' },
  )
  return {
    id: `job-machine-${Date.now()}`,
    kind: 'machine',
    subject: state.machineNames?.[machine] ?? machine,
    project: String(body.project),
    steps,
    failure: failing === -1 ? null : notice('pool.noPush', { remote: 'https://git.example.com/acme/abc.git' }),
    done: failing === -1,
    undoable: failing !== -1,
  }
}

/** The project whose push check fails in the fake's "Connect" of the window "Add a machine": the laptop's last. */
const joinFailing = (machine: string, requests: JoinRequest[]): string | undefined => (machine === 'machine-1' && requests.length > 1 ? requests.at(-1)?.project : undefined)

/**
 * The job "Connect" of the window "Add a machine" starts (BTN-1263): each project's steps done at once, except on the
 * laptop with more than one project, where the last one's push check fails with what to do.
 */
function joinJob(state: EvenKeelState, body: Record<string, unknown>): StepJob {
  const machine = String(body.machine)
  const requests = (body.projects as JoinRequest[] | undefined) ?? []
  const failing = joinFailing(machine, requests)
  const at = new Date().toISOString()
  let failed = false
  const steps: JobStep[] = requests.flatMap(({ project, clone }) =>
    [...(clone ? ['machine-clone'] : []), 'machine-place', ...CONNECT_CHECKS, 'machine-enable'].map((step): JobStep => {
      const id = `${step}@${project}`
      if (failed) return { id, state: 'waiting' }
      if (project === failing && step === 'machine-push') {
        failed = true
        return { id, state: 'failed', startedAt: at, endedAt: at }
      }
      return { id, state: 'done', startedAt: at, endedAt: at }
    }),
  )
  return {
    id: `job-join-${Date.now()}`,
    kind: JOIN_KIND,
    subject: state.machineNames?.[machine] ?? (machine === 'machine-1' ? 'Example laptop' : machine),
    steps,
    failure: failed ? notice('pool.noPush', { remote: `https://git.example.com/acme/${(state.projectKeys[failing!] ?? 'abc').toLowerCase()}.git` }) : null,
    done: !failed,
    undoable: failed,
  }
}

/**
 * `?machines=signIn|login|offline|nocli` (BTN-1245): a machine elsewhere where the active Claude account is not signed
 * in; `login` with its sign-in under way, `offline` gone from the link, `nocli` without the Claude CLI, `token` with the
 * other machine on long tokens (BTN-1002). Its commands go through `fakeMachineCommand`.
 */
export function fakeMachineSignIns(state: EvenKeelState, mode: string | null): MachineSignIn[] | undefined {
  if (mode === null) return undefined
  const desktop: MachineSignIn = {
    machine: 'machine-2', name: 'Example desktop', online: true, login: null, missing: [],
    accounts: state.account.accounts
      .filter((entry) => entry.status?.loggedIn === true)
      .map((entry) => ({ key: entry.key, agent: entry.agent, email: entry.status?.email ?? null, signedIn: true, ...(mode === 'token' && { longToken: true as const }) })),
  }
  const laptop: MachineSignIn = {
    machine: 'machine-1', name: 'Example laptop', online: mode !== 'offline', login: null, missing: mode === 'nocli' ? ['claude'] : [], accounts: [],
  }
  const machines = [laptop, desktop]
  return mode === 'login' ? machines.map((machine) => (machine === laptop ? { ...machine, login: loginOf('claude', null) } : machine)) : machines
}

const loginOf = (agent: string, target: string | null): MachineSignIn['login'] => ({
  agent, target, startedAt: new Date().toISOString(), urls: ['https://claude.ai/oauth/authorize?code=true&client_id=example'],
  deviceCode: null, output: 'Opening browser to sign in…\nPaste code here if prompted >', error: null, codeSent: false,
})

/** The machines' sign-in commands on the fake state; `null` — not one of them. */
export function fakeMachineCommand(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState | null {
  if (name === 'machines/connect') return { ...state, jobs: [...(state.jobs ?? []), connectJob(state, body)] }
  if (name === 'machines/join') return { ...state, jobs: [...(state.jobs ?? []), joinJob(state, body)] }
  const machines = state.machineSignIns
  if (machines === undefined || !name.startsWith('machines/')) return null
  const change = (machine: string, patch: (each: MachineSignIn) => MachineSignIn): EvenKeelState => ({
    ...state, machineSignIns: machines.map((each) => (each.machine === machine ? patch(each) : each)),
  })
  const machine = String(body.machine)
  if (name === 'machines/login') return change(machine, (each) => ({ ...each, login: loginOf(String(body.agent ?? 'claude'), typeof body.account === 'string' ? body.account : null) }))
  if (name === 'machines/cancel') return change(machine, (each) => ({ ...each, login: null }))
  if (name === 'machines/token') {
    const hub = state.account.accounts.find((entry) => entry.key === body.account)
    return change(machine, (each) => ({
      ...each,
      accounts: [...each.accounts, { key: 'token', agent: 'claude', email: hub?.status?.email ?? null, signedIn: true, longToken: true }],
    }))
  }
  if (name === 'machines/code') {
    const active = state.account.accounts.find((entry) => entry.key === state.account.active)
    return change(machine, (each) => ({
      ...each, login: null,
      accounts: [...each.accounts, { key: active?.status?.email ?? 'john.doe@example.com', agent: 'claude', email: active?.status?.email ?? null, signedIn: true }],
    }))
  }
  return null
}
