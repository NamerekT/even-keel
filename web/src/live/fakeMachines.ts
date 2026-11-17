import type { EvenKeelState, MachineSignIn } from '../../../src/state.js'

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
