import { notice } from '../../../src/notice/notice.js'
import type { EvenKeelState, JobStep, MachineAbout, MachineInvite, MachineSignIn, MachineView, PoolMachine, ProjectPool, StepJob } from '../../../src/state.js'

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
  constructor(mode: string | null, private readonly repoOf: (project: string) => string = () => '') {
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

  /**
   * `machines/projects` and `machines/enable`; `false` — another command. `machines/connect` puts the machine into the
   * pool turned off and answers `false` too: its job is the state's, `fakeMachineCommand`.
   */
  command(name: string, body: Record<string, unknown>): boolean {
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
    if (name !== 'machines/projects') return false
    const projects = (body.projects as string[]) ?? []
    this.machines = this.machines.map((machine) => (machine.id === body.machine ? { ...machine, projects: [...new Set([...machine.projects, ...projects])] } : machine))
    this.changed()
    return true
  }
}

/** The hub's own machine in `dev:fake`, as `?machines=…` names it in `machineNames`. */
const OWN = 'pc'
const OWN_NAME = 'Workstation'

/** The machine names of `?machines=…`: the hub's own and the two machines elsewhere, so the project's "Machines" shows. */
export const FAKE_MACHINE_NAMES: Record<string, string> = { [OWN]: OWN_NAME, 'machine-1': 'Example laptop', 'machine-2': 'Example desktop' }

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
