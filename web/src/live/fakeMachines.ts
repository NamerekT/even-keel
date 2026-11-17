import type { EvenKeelState, MachineAbout, MachineInvite, MachineSignIn, MachineView } from '../../../src/state.js'

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

  constructor(mode: string | null) {
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

  /** `machines/projects`; `false` — another command. */
  command(name: string, body: Record<string, unknown>): boolean {
    if (name !== 'machines/projects') return false
    const projects = (body.projects as string[]) ?? []
    this.machines = this.machines.map((machine) => (machine.id === body.machine ? { ...machine, projects: [...new Set([...machine.projects, ...projects])] } : machine))
    for (const listener of this.listeners) listener()
    return true
  }
}

/**
 * `?machines=signIn|login|offline|nocli` (BTN-1245): a machine elsewhere where the active Claude account is not signed
 * in; `login` with its sign-in under way, `offline` gone from the link, `nocli` without the Claude CLI. Its commands
 * go through `fakeMachineCommand`.
 */
export function fakeMachineSignIns(state: EvenKeelState, mode: string | null): MachineSignIn[] | undefined {
  if (mode === null) return undefined
  const desktop: MachineSignIn = {
    machine: 'machine-2', name: 'Example desktop', online: true, login: null, missing: [],
    accounts: state.account.accounts.filter((entry) => entry.status?.loggedIn === true).map((entry) => ({ key: entry.key, agent: entry.agent, email: entry.status?.email ?? null, signedIn: true })),
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
  const machines = state.machineSignIns
  if (machines === undefined || !name.startsWith('machines/')) return null
  const change = (machine: string, patch: (each: MachineSignIn) => MachineSignIn): EvenKeelState => ({
    ...state, machineSignIns: machines.map((each) => (each.machine === machine ? patch(each) : each)),
  })
  const machine = String(body.machine)
  if (name === 'machines/login') return change(machine, (each) => ({ ...each, login: loginOf(String(body.agent ?? 'claude'), typeof body.account === 'string' ? body.account : null) }))
  if (name === 'machines/cancel') return change(machine, (each) => ({ ...each, login: null }))
  if (name === 'machines/code') {
    const active = state.account.accounts.find((entry) => entry.key === state.account.active)
    return change(machine, (each) => ({
      ...each, login: null,
      accounts: [...each.accounts, { key: active?.status?.email ?? 'john.doe@example.com', agent: 'claude', email: active?.status?.email ?? null, signedIn: true }],
    }))
  }
  return null
}
