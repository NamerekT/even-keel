import { describe, expect, it } from 'vitest'
import type { AccountEntry, AccountView } from '../../src/account/model.js'
import type { RateLimits } from '../../src/limits/model.js'
import type { MachineCard, MachineCardAccount, MachineSignIn } from '../../src/state.js'
import { machineAccountView, machineLevels, machineUses } from './machineAccountView.js'

const limits = (used: number) => ({ fiveHour: { usedPercentage: used, resetsAt: null }, sevenDay: null, updatedAt: '', source: 'usage' }) as unknown as RateLimits

const account = (key: string, patch: Partial<MachineCardAccount> = {}): MachineCardAccount => ({
  key, agent: 'claude', email: `${key}@example.com`, signedIn: true, name: null, limits: null, ...patch,
})

const card = (patch: Partial<MachineCard> = {}): MachineCard => ({
  id: 'm1', name: 'Example desktop', color: '#7a8fa6', own: false, online: true, offlineSince: null, gitUser: true, agents: ['claude'],
  limitedUntil: {}, projects: [], accounts: [], active: null, ...patch,
})

const entry = (key: string, patch: Partial<AccountEntry> = {}): AccountEntry => ({
  key, name: null, agent: 'claude', global: false, error: null, loginExpiresAt: null, needsLogin: false, sessions: ['s1'], projects: ['ABC'],
  removing: false, configPending: false, apiKey: false, limits: limits(5), usage: { state: 'ok', reason: null, since: null },
  status: { loggedIn: true, authMethod: 'claude.ai', email: `${key}@example.com`, orgName: null, subscriptionType: 'max' }, ...patch,
})

const hub = (accounts: AccountEntry[], active = 'john'): AccountView => ({ active, accounts, pool: [], apps: [], login: null, loginBlock: null, missing: [] })

const signIn = (accounts: MachineCardAccount[], patch: Partial<MachineSignIn> = {}): MachineSignIn => ({
  machine: 'm1', name: 'Example desktop', online: true, accounts, login: null, missing: [], ...patch,
})

describe('machineAccountView', () => {
  it("gives the machine's accounts with the limits it read and the hub's plan, then the hub's accounts not signed in there", () => {
    const accounts = [account('folder', { email: 'John@example.com', limits: limits(37), sessions: ['a', 'b'], transport: 'sdk' }), account('mary', { signedIn: false })]
    const view = machineAccountView(hub([entry('john'), entry('jane'), entry('mary')]), card({ accounts, active: 'folder' }), signIn(accounts))
    expect(view.view.accounts.map((each) => [each.key, each.status?.email, each.status?.subscriptionType, each.limits?.fiveHour?.usedPercentage ?? null, each.sessions.length, each.transport ?? null])).toEqual([
      ['claude:folder', 'John@example.com', 'max', 37, 2, 'sdk'],
      ['claude:mary', 'mary@example.com', 'max', null, 0, null],
      ['hub:jane', 'jane@example.com', 'max', null, 0, null],
    ])
    expect(view.view.active).toBe('claude:folder')
    expect([...view.away]).toEqual([
      ['claude:mary', { agent: 'claude', account: 'mary', why: 'out', way: 'subscription', noCli: false }],
      ['hub:jane', { agent: 'claude', why: 'hub', way: 'subscription', noCli: false }],
    ])
    expect([...view.here]).toEqual([['john', 'claude:folder'], ['mary', 'claude:mary'], ['jane', 'hub:jane']])
  })

  it('keeps an account only the machine has, and names an agent whose CLI the machine lacks', () => {
    const accounts = [account('other', { agent: 'codex', email: null, name: 'Spare' })]
    const view = machineAccountView(hub([entry('john')]), card({ accounts }), signIn(accounts, { missing: ['claude'] }))
    expect(view.view.accounts.map((each) => [each.key, each.agent, each.name, each.status?.email ?? null])).toEqual([
      ['codex:other', 'codex', 'Spare', null],
      ['hub:john', 'claude', null, 'john@example.com'],
    ])
    expect(view.away.get('hub:john')).toEqual({ agent: 'claude', why: 'hub', way: 'subscription', noCli: true })
    expect(view.view.active).toBe('')
  })

  it("names an account the hub has by the hub's folder, one name everywhere; a key or one the hub lacks by the machine's (BTN-1584)", () => {
    const accounts = [
      account('folder', { email: 'John@example.com', name: 'Old name there' }),
      account('key', { email: null, name: 'Key there' }),
      account('solo', { name: 'Solo there' }),
    ]
    const view = machineAccountView(hub([entry('john', { name: 'Work' })]), card({ accounts }), signIn(accounts))
    expect(view.view.accounts.slice(0, 3).map((each) => [each.key, each.name])).toEqual([['claude:folder', 'Work'], ['claude:key', 'Key there'], ['claude:solo', 'Solo there']])
    expect([...view.hubFolders]).toEqual([['claude:folder', 'john']])
  })

  it("carries a folder being removed there and the machine's VS Code by the view's keys (BTN-1584)", () => {
    const accounts = [account('folder', { removing: true }), account('other')]
    const apps = [{ app: 'vscode' as const, account: 'other', dir: '/home/example/.claude-other', error: null, sessions: [{ name: 'Chat', session: 's9', account: 'other', status: null }] }]
    const view = machineAccountView(hub([]), card({ accounts, apps }), signIn(accounts))
    expect(view.view.accounts.map((each) => [each.key, each.removing])).toEqual([['claude:folder', true], ['claude:other', false]])
    expect(view.view.apps).toEqual([{ ...apps[0], account: 'claude:other', sessions: [{ ...apps[0]!.sessions[0], account: 'claude:other' }] }])
  })

  it('lists no hub account before the machine told its accounts', () => {
    const view = machineAccountView(hub([entry('john')]), card(), undefined)
    expect(view.view.accounts).toEqual([])
  })
})

describe('machineLevels', () => {
  const accounts = [account('folder', { email: 'john@example.com', limits: limits(37) })]
  const view = machineAccountView(hub([entry('john'), entry('jane'), entry('key', { apiKey: true })]), card({ accounts, active: 'folder' }), signIn(accounts))

  it("gives each hub level the machine's account of it, the shared one the machine's launch account", () => {
    const levels = machineLevels([
      { account: 'john', source: 'task', task: 'ABC-5' },
      { account: 'jane', source: 'project' },
      { account: 'key', source: 'shared' },
    ], view)
    expect(levels).toEqual([
      { account: 'claude:folder', source: 'task', task: 'ABC-5' },
      { account: 'hub:jane', source: 'project' },
    ])
  })

  it('drops a level the machine has nothing of', () => {
    const none = machineAccountView(hub([entry('key', { apiKey: true })], 'key'), card(), signIn([]))
    expect(machineLevels([{ account: 'key', source: 'shared' }], none)).toEqual([])
  })
})

describe('machineUses', () => {
  it('names where the machine takes each account, Even Keel first, once each', () => {
    const accounts = [account('folder', { email: 'john@example.com' })]
    const view = machineAccountView(hub([entry('john'), entry('jane')]), card({ accounts, active: 'folder' }), signIn(accounts))
    const uses = machineUses({
      ABC: [{ account: 'john', source: 'task', task: 'ABC-5' }, { account: 'jane', source: 'project' }, { account: 'john', source: 'shared' }],
      XYZ: [{ account: 'jane', source: 'project' }, { account: 'john', source: 'shared' }],
    }, view)
    expect([...uses]).toEqual([
      ['claude:folder', [{ source: 'shared' }, { source: 'task', task: 'ABC-5' }]],
      ['hub:jane', [{ source: 'project', project: 'ABC' }, { source: 'project', project: 'XYZ' }]],
    ])
  })
})
