import { describe, expect, it } from 'vitest'
import type { AccountEntry } from '../../src/account/model.js'
import type { MachineAbout, MachineSignIn, MachineView } from '../../src/state.js'
import { addMachineOf, folderOnMachine, hubGapsOn, joinedMachine, joinRequests, machineAccounts, machineAccountsEmpty, machineAddChoices, machineChecks, osLabel, signInOf, takenColors, withAddMachine } from './machineAdd.js'

describe('the folder a project gets on a machine', () => {
  it("is the hub's folder name inside the machine's root, written the machine's way", () => {
    expect(folderOnMachine('/home/example/projects', 'D:\\repos\\abc\\')).toBe('/home/example/projects/abc')
    expect(folderOnMachine('C:\\projects\\', '/srv/repos/abc')).toBe('C:\\projects\\abc')
    expect(folderOnMachine('/home/example/projects/', '')).toBe('/home/example/projects')
  })
})

describe('the colours machines have', () => {
  it('are those of the own machine and every joined one not revoked', () => {
    const state = { machineNames: { pc: 'PC', a: 'A', b: 'B', c: 'C' }, machineColors: { pc: '#111111', a: '#222222', b: '#333333', c: '#444444' } }
    const machines = [view({ id: 'a' }), view({ id: 'b', revokedAt: 5 }), view({ id: 'c', joinedAt: null })]
    expect(takenColors(state, machines)).toEqual(['#111111', '#222222'])
    expect(takenColors({ machineNames: { pc: 'PC' } }, [])).toEqual([])
  })
})

describe('the projects "Connect" sends', () => {
  it('takes the fresh ones in the hub order, a clone unless a folder is picked, a folder only when named', () => {
    const picks = { b: { clone: false, folder: ' /srv/b ' }, c: { clone: false, folder: '' } }
    expect(joinRequests(['a', 'b', 'c', 'd'], new Set(['c', 'a', 'b']), picks)).toEqual([
      { project: 'a', clone: true },
      { project: 'b', clone: false, folder: '/srv/b' },
      { project: 'c', clone: false },
    ])
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
    expect(machineChecks({ ...ABOUT, node: '22.3.0', git: '2.47.0', gitUser: false, agents: { opencode: null } }, [])).toEqual([
      { id: 'node', ok: false, version: '22.3.0' },
      { id: 'git', ok: false, version: '2.47.0', user: false },
      { id: 'agent:opencode', ok: true, agent: 'opencode', version: null },
    ])
    expect(machineChecks({ ...ABOUT, git: null }, [])[1]).toEqual({ id: 'git', ok: false, version: null, user: true })
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
