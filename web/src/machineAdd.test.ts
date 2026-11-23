import { describe, expect, it } from 'vitest'
import type { AccountEntry } from '../../src/account/model.js'
import type { MachineAbout, MachineSignIn, MachineView } from '../../src/state.js'
import { HUB_PLACE } from './accountAdd.js'
import { addMachineOf, defaultPlace, hubGapsOn, joinedMachine, joinRequests, machineAccounts, machineAccountsEmpty, machineAddChoices, machineAgents, machineChecks, osLabel, sharedTokens, signInOf, takenColors, tokenAccounts, withAddMachine } from './machineAdd.js'

describe('the colours machines have', () => {
  it('are those of the own machine and every joined one not revoked', () => {
    const state = { machineNames: { pc: 'PC', a: 'A', b: 'B', c: 'C' }, machineColors: { pc: '#111111', a: '#222222', b: '#333333', c: '#444444' } }
    const machines = [view({ id: 'a' }), view({ id: 'b', revokedAt: 5 }), view({ id: 'c', joinedAt: null })]
    expect(takenColors(state, machines)).toEqual(['#111111', '#222222'])
    expect(takenColors({ machineNames: { pc: 'PC' } }, [])).toEqual([])
  })
})

describe('the projects "Connect" sends', () => {
  it('takes the fresh ones in the hub order, each folder when known and no clone flag: the folder decides', () => {
    const folders = { b: '/srv/b', c: null, d: '/srv/d' }
    expect(joinRequests(['a', 'b', 'c', 'd'], new Set(['c', 'a', 'b']), folders)).toEqual([{ project: 'a' }, { project: 'b', folder: '/srv/b' }, { project: 'c' }])
  })
})

const ABOUT: MachineAbout = {
  host: 'example-laptop', os: 'linux 6.8.0', evenKeel: '0.4.0', node: '24.11.0', git: '2.47.0', agents: { claude: '2.1.322' }, gitUser: true, root: '/home/example/projects',
}

const view = (patch: Partial<MachineView> = {}): MachineView => ({
  id: 'machine-1', name: 'Example laptop', createdAt: 1, revokedAt: null, inviteExpires: null, joinedAt: 2, host: 'example-laptop', about: ABOUT,
  online: true, projects: [], taken: [], ...patch,
})

const entry = (patch: Partial<AccountEntry> = {}): AccountEntry => ({
  key: 'john.doe@example.com', name: null, global: false, agent: 'claude',
  status: { loggedIn: true, authMethod: 'claude.ai', email: 'john.doe@example.com', orgName: null, subscriptionType: 'max' },
  error: null, loginExpiresAt: null, needsLogin: false, sessions: [], projects: [], removing: false, configPending: false, apiKey: false,
  limits: null, usage: { state: 'ok', reason: null, since: null },
  ...patch,
} as AccountEntry)

describe('what the window that adds a machine shows', () => {
  it('opens at the address step or at a machine that joined, and closes without its key', () => {
    expect(addMachineOf(new URLSearchParams('?addMachine=new'))).toBe('new')
    expect(addMachineOf(new URLSearchParams('?addMachine=machine-1&x=1'))).toBe('machine-1')
    expect(addMachineOf(new URLSearchParams('?x=1'))).toBeNull()
    expect(withAddMachine('?x=1', 'new')).toBe('?x=1&addMachine=new')
    expect(withAddMachine('?x=1&addMachine=new', 'machine-1')).toBe('?x=1&addMachine=machine-1')
    expect(withAddMachine('?addMachine=new', null)).toBe('')
  })

  it('takes the machine issued for once it joined, not before and not a revoked one', () => {
    expect(joinedMachine([view({ joinedAt: null, inviteExpires: 9 })], 'machine-1')).toBeUndefined()
    expect(joinedMachine([view({ revokedAt: 3 })], 'machine-1')).toBeUndefined()
    expect(joinedMachine([view({ id: 'machine-2' }), view()], 'machine-1')?.id).toBe('machine-1')
  })

  it('names the system by its platform and keeps its release', () => {
    expect(osLabel('linux 6.8.0')).toBe('Linux 6.8.0')
    expect(osLabel('win32 10.0.26200')).toBe('Windows 10.0.26200')
    expect(osLabel('darwin 24.1.0')).toBe('macOS 24.1.0')
    expect(osLabel('freebsd 14.1')).toBe('freebsd 14.1')
  })

  it("checks Node, git with its user and the CLIs of the hub's agents, a missing one with what follows", () => {
    expect(machineChecks(ABOUT, ['claude', 'codex'])).toEqual([
      { id: 'node', ok: true, version: '24.11.0' },
      { id: 'git', ok: true, version: '2.47.0', user: true },
      { id: 'agent:claude', ok: true, agent: 'claude', version: '2.1.322' },
      { id: 'agent:codex', ok: false, agent: 'codex', version: null },
    ])
    // A report names every agent it asked: `null` is a CLI not there, listed only when the hub has its accounts.
    expect(machineChecks({ ...ABOUT, node: '22.3.0', git: '2.47.0', gitUser: false, agents: { opencode: null, copilot: '1.0.0' } }, ['codex'])).toEqual([
      { id: 'node', ok: false, version: '22.3.0' },
      { id: 'git', ok: false, version: '2.47.0', user: false },
      { id: 'agent:codex', ok: false, agent: 'codex', version: null },
      { id: 'agent:copilot', ok: true, agent: 'copilot', version: '1.0.0' },
    ])
    expect(machineChecks({ ...ABOUT, git: null }, [])[1]).toEqual({ id: 'git', ok: false, version: null, user: true })
  })

  it("tags only the CLIs the machine has, and warns of the hub's agents it lacks", () => {
    const about = { ...ABOUT, agents: { claude: '2.1.327', codex: null, opencode: null, copilot: '1.0.0' } }
    expect(machineAgents(about, ['codex', 'opencode', 'copilot'], ['claude', 'codex'])).toEqual({ found: [{ agent: 'claude', version: '2.1.327' }], lacking: ['codex'] })
    expect(machineAgents(about, [], [])).toEqual({ found: [{ agent: 'claude', version: '2.1.327' }, { agent: 'copilot', version: '1.0.0' }], lacking: [] })
    expect(machineAgents({ ...ABOUT, agents: {} }, [], ['claude', 'claude'])).toEqual({ found: [], lacking: ['claude'] })
  })

  it("takes the machine's accounts from the page's state, or none yet with the CLIs its report misses", () => {
    const signIns: MachineSignIn[] = [{ machine: 'machine-2', name: 'Example desktop', online: true, accounts: [], login: null, missing: [] }]
    expect(signInOf(view(), signIns, ['claude', 'codex'])).toEqual({
      machine: 'machine-1', name: 'Example laptop', online: true, accounts: [], login: null, missing: ['codex'],
    })
    expect(signInOf(view({ id: 'machine-2' }), signIns, ['claude'])).toBe(signIns[0])
  })

  it('lists each hub subscription once with its sign-in on the machine; keys and signed-out folders are not carried', () => {
    const machine: MachineSignIn = {
      machine: 'machine-1', name: 'Example laptop', online: true, login: null, missing: ['codex'],
      accounts: [{ key: 'jane', agent: 'claude', email: 'jane.roe@example.com', signedIn: true }],
    }
    const accounts = [
      entry(),
      entry({ key: 'john-2' }),
      entry({ key: 'jane', status: { loggedIn: true, authMethod: 'claude.ai', email: 'jane.roe@example.com', orgName: null, subscriptionType: 'pro' } }),
      entry({ key: 'codex', agent: 'codex' }),
      entry({ key: 'key', apiKey: true }),
      entry({ key: 'out', status: { loggedIn: false, authMethod: null, email: null, orgName: null, subscriptionType: null } as never }),
    ]
    expect(machineAccounts(accounts, machine).map((row) => [row.entry.key, row.gap === null ? 'signed in' : row.gap.noCli ? 'no cli' : 'gap'])).toEqual([
      ['john.doe@example.com', 'gap'],
      ['jane', 'signed in'],
      ['codex', 'no cli'],
    ])
  })

  it('marks an account the machine runs on a long token (BTN-1002)', () => {
    const machine: MachineSignIn = {
      machine: 'machine-1', name: 'Example laptop', online: true, login: null, missing: [],
      accounts: [{ key: 'token', agent: 'claude', email: 'john.doe@example.com', signedIn: true, longToken: true }],
    }
    expect(machineAccounts([entry()], machine)).toEqual([{ entry: entry(), gap: null, token: true }])
  })
})

describe("a machine's accounts page (BTN-1302)", () => {
  const machine = (patch: Partial<MachineSignIn> = {}): MachineSignIn => ({
    machine: 'machine-1', name: 'Example laptop', online: true, login: null, missing: [], accounts: [], ...patch,
  })

  it("offers each hub subscription the machine is not signed in to, except one its own signed-out folder signs in again", () => {
    const jane = entry({ key: 'jane', status: { loggedIn: true, authMethod: 'claude.ai', email: 'jane.roe@example.com', orgName: null, subscriptionType: 'pro' } })
    const signedIn = machine({ accounts: [{ key: 'jane', agent: 'claude', email: 'jane.roe@example.com', signedIn: true }] })
    expect(hubGapsOn([entry(), jane], signedIn).map((row) => row.entry.key)).toEqual(['john.doe@example.com'])
    const signedOut = machine({ accounts: [{ key: 'john', agent: 'claude', email: 'john.doe@example.com', signedIn: false }] })
    expect(hubGapsOn([entry(), jane], signedOut).map((row) => row.entry.key)).toEqual(['jane'])
    expect(hubGapsOn([entry({ agent: 'codex' })], machine({ missing: ['codex'] }))[0]?.gap.noCli).toBe(true)
  })

  it('says the machine sent no accounts yet only before its first snapshot', () => {
    expect(machineAccountsEmpty('machine-1', [])).toBe('waiting')
    expect(machineAccountsEmpty('machine-1', undefined)).toBe('waiting')
    expect(machineAccountsEmpty('machine-1', [machine()])).toBe('none')
  })

  it('adds an account of each agent that signs in through a browser, one whose CLI is missing off', () => {
    expect(machineAddChoices(machine({ missing: ['codex'] }))).toEqual([
      { agent: 'claude', missing: false },
      { agent: 'codex', missing: true },
      { agent: 'opencode', method: 'chatgpt', missing: false },
    ])
  })
})

describe('where "Add account" signs in (BTN-1308)', () => {
  const machine = (patch: Partial<MachineSignIn> = {}): MachineSignIn => ({
    machine: 'machine-1', name: 'Example laptop', online: true, login: null, missing: [], accounts: [], ...patch,
  })

  it("picks the machine of the page it opened over — its page or the header's choice — while it is on the link", () => {
    const machines = [machine(), machine({ machine: 'machine-2', name: 'Example server', online: false })]
    expect(defaultPlace('/machines/machine-1', '', machines)).toBe('machine-1')
    expect(defaultPlace('/accounts', '?machine=machine-1', machines)).toBe('machine-1')
    expect(defaultPlace('/', '?machine=machine-1&addAccount=', machines)).toBe('machine-1')
    expect(defaultPlace('/machines/machine-2', '', machines)).toBe(HUB_PLACE)
    expect(defaultPlace('/machines/machine-9', '', machines)).toBe(HUB_PLACE)
    expect(defaultPlace('/accounts', '?machine=own-pc', machines)).toBe(HUB_PLACE)
    expect(defaultPlace('/accounts', '', machines)).toBe(HUB_PLACE)
    expect(defaultPlace('/machines/machine-1', '', undefined)).toBe(HUB_PLACE)
  })

  it("ties a long token to a hub Claude subscription the machine is not signed in to", () => {
    const jane = entry({ key: 'jane', status: { loggedIn: true, authMethod: 'claude.ai', email: 'jane.roe@example.com', orgName: null, subscriptionType: 'pro' } })
    const codex = entry({ key: 'codex-john', agent: 'codex' })
    const signedIn = machine({ accounts: [{ key: 'jane', agent: 'claude', email: 'jane.roe@example.com', signedIn: true }] })
    expect(tokenAccounts([entry(), jane, codex], signedIn)).toEqual([{ account: 'john.doe@example.com', who: 'john.doe@example.com' }])
    expect(tokenAccounts([codex], machine())).toEqual([])
  })

  it('offers the long tokens the hub runs on, but not one refused, past its last day or already there (BTN-1501)', () => {
    const NOW = Date.parse('2026-11-23T10:00:00.000Z')
    const token = (key: string, longToken: AccountEntry['longToken'], name: string | null = null) =>
      entry({ key, name, status: { loggedIn: true, authMethod: 'claude.ai', email: null, orgName: null, subscriptionType: null }, longToken })
    const accounts = [
      entry(),
      token('token', { until: '2027-11-01T00:00:00.000Z', sameAs: 'john.doe@example.com' }, 'Work token'),
      token('token-2', { until: null }),
      token('refused', { until: null, refusedAt: '2026-11-20T00:00:00.000Z' }),
      token('old', { until: '2026-11-01T00:00:00.000Z' }),
      token('there', { until: null }, 'Already there'),
      entry({ key: 'codex-token', agent: 'codex', longToken: { until: null } }),
    ]
    const on = machine({ accounts: [{ key: 'there', agent: 'claude', email: null, signedIn: true, longToken: true }] })
    expect(sharedTokens(accounts, on, NOW).map((each) => each.from)).toEqual(['token', 'token-2'])
    expect(sharedTokens(accounts, on, NOW)[0]).toEqual({ from: 'token', who: 'Work token' })
    expect(sharedTokens([entry()], on, NOW)).toEqual([])
  })
})
