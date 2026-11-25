import { describe, expect, it } from 'vitest'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import type { ChatMachines } from '../../../src/chats/model.js'
import { accountAfter, agentsOpen, agentToggled, chatAccounts, chatOptions, machineChoices, machineFirst, machinePanel } from './chatMachines.js'

const entry = (key: string): AccountEntry => ({ key, agent: 'claude' }) as AccountEntry
const panel = (...keys: string[]): AccountView => ({ active: keys[0] ?? '', accounts: keys.map(entry) }) as AccountView

const OWN_PANEL = panel('global', 'work')
const answer: ChatMachines = {
  picked: 'machine-own',
  machines: [
    { id: 'machine-own', name: 'Workstation', own: true, block: null, accounts: null },
    { id: 'machine-far', name: 'Home server', own: false, block: null, accounts: panel('server-work') },
    { id: 'machine-away', name: 'Bench box', own: false, block: 'offline', accounts: null },
  ],
}

describe('the machine of a new chat (BTN-1614)', () => {
  it('offers no pick while the project has one machine or the answer has not come', () => {
    expect(machineChoices(null)).toEqual([])
    expect(machineChoices({ picked: 'machine-own', machines: answer.machines.slice(0, 1) })).toEqual([])
    expect(machineChoices(answer).map((machine) => machine.id)).toEqual(['machine-own', 'machine-far', 'machine-away'])
  })

  it("shows the accounts of the machine picked: the own one's live, one elsewhere's from the answer", () => {
    expect(machinePanel(answer, 'machine-own', OWN_PANEL)).toBe(OWN_PANEL)
    expect(machinePanel(answer, 'machine-far', OWN_PANEL)?.accounts.map((each) => each.key)).toEqual(['server-work'])
    expect(machinePanel(answer, 'machine-away', OWN_PANEL)).toBeUndefined()
    expect(machinePanel(null, null, OWN_PANEL)).toBe(OWN_PANEL)
  })

  it("keeps the account when the new machine has it open, else the last choice's, else the first open one", () => {
    const open = [entry('server-work'), entry('global')]
    expect(accountAfter(open, 'global', 'server-work')?.key).toBe('global')
    expect(accountAfter(open, 'work', 'global')?.key).toBe('global')
    expect(accountAfter(open, 'work', undefined)?.key).toBe('server-work')
    expect(accountAfter([], 'work', 'global')).toBeUndefined()
  })

  it("offers the last choice's machine first while it can take a chat, else the one the hub picked (BTN-1710)", () => {
    expect(machineFirst(answer, 'machine-far')).toBe('machine-far')
    expect(machineFirst(answer, 'machine-away')).toBe('machine-own')
    expect(machineFirst(answer, 'machine-gone')).toBe('machine-own')
    expect(machineFirst(answer, undefined)).toBe('machine-own')
    expect(machineFirst(null, 'machine-far')).toBeNull()
  })
})

describe('the agents of the "New session" window unfolded (BTN-1710)', () => {
  it("unfolds the agent of the account offered first until one is folded or unfolded by hand, which then stays", () => {
    expect([...agentsOpen(null, 'codex')]).toEqual(['codex'])
    expect([...agentsOpen(null, undefined)]).toEqual([])
    expect([...agentsOpen(new Set(['claude', 'opencode']), 'codex')]).toEqual(['claude', 'opencode'])
    expect([...agentsOpen(new Set(), 'codex')]).toEqual([])
  })

  it('folds or unfolds one agent, the others as they were', () => {
    expect([...agentToggled(new Set(['claude']), 'codex')]).toEqual(['claude', 'codex'])
    expect([...agentToggled(new Set(['claude', 'codex']), 'claude')]).toEqual(['codex'])
  })
})

describe('the accounts a chat goes on with in a new session (BTN-1614)', () => {
  it("offers the own machine's live accounts for a chat there or of an older service", () => {
    expect(chatAccounts(null, 'machine-own', 'machine-own', OWN_PANEL)).toBe(OWN_PANEL.accounts)
    expect(chatAccounts(null, undefined, 'machine-own', OWN_PANEL)).toBe(OWN_PANEL.accounts)
  })

  it("offers a machine elsewhere's accounts once the answer comes, none when it does not tell them", () => {
    expect(chatAccounts(null, 'machine-far', 'machine-own', OWN_PANEL)).toBeUndefined()
    expect(chatAccounts(answer, 'machine-far', 'machine-own', OWN_PANEL)?.map((each) => each.key)).toEqual(['server-work'])
    expect(chatAccounts(answer, 'machine-away', 'machine-own', OWN_PANEL)).toEqual([])
    expect(chatAccounts(answer, 'machine-gone', 'machine-own', OWN_PANEL)).toEqual([])
  })
})

const account = (key: string, fields: Partial<AccountEntry> = {}): AccountEntry => ({
  key, name: null, agent: 'claude', global: false, needsLogin: false, removing: false, apiKey: false, limits: null,
  status: { loggedIn: true, authMethod: 'claude.ai', email: `${key}@example.com`, orgName: null, subscriptionType: 'max' },
  ...fields,
}) as AccountEntry

describe('the accounts of a machine elsewhere in the "New session" window (BTN-1670)', () => {
  const hub = { active: 'work', accounts: [account('work', { name: 'Work', status: { loggedIn: true, authMethod: 'claude.ai', email: 'jane@example.com', orgName: null, subscriptionType: 'max' } })] } as AccountView
  const far = (accounts: AccountEntry[]): ChatMachines => ({
    picked: 'machine-own',
    machines: [answer.machines[0]!, { id: 'machine-far', name: 'Home server', own: false, block: null, accounts: { active: '', accounts } as unknown as AccountView }],
  })

  it("names an account by the hub's name of the same e-mail, keeping the machine's folder key", () => {
    const there = account('claude-3', { status: { loggedIn: true, authMethod: 'claude.ai', email: 'JANE@example.com', orgName: null, subscriptionType: 'max' } })
    const shown = machinePanel(far([there, account('solo')]), 'machine-far', hub)?.accounts
    expect(shown?.map((each) => [each.key, each.name])).toEqual([['claude-3', 'Work'], ['solo', null]])
  })

  it('names a signed-out folder by the e-mail it was last signed in as', () => {
    const out = account('claude-4', { needsLogin: true, lastEmail: 'jane@example.com', status: { loggedIn: false, authMethod: null, email: null, orgName: null, subscriptionType: null } })
    expect(machinePanel(far([out]), 'machine-far', hub)?.accounts[0]?.name).toBe('Work')
  })
})

describe('the accounts a new chat may start on (BTN-1670)', () => {
  const spent = account('spent', { limits: { fiveHour: { usedPercentage: 100, resetsAt: '2026-11-25T12:00:00Z' }, sevenDay: null } as AccountEntry['limits'] })

  it('leaves out one signed out there, one whose sign-in expired and one being removed', () => {
    const view = { active: '', accounts: [
      account('open'),
      account('out', { status: { loggedIn: false, authMethod: null, email: null, orgName: null, subscriptionType: null } }),
      account('expired', { needsLogin: true }),
      account('unread', { status: null }),
      account('leaving', { removing: true }),
    ] } as unknown as AccountView
    expect(chatOptions(view).accounts.map((each) => each.key)).toEqual(['open'])
  })

  it('leaves out an API account whose key the provider refused or the CLI does not find, keeps one with its key', () => {
    const key = { loggedIn: true, authMethod: 'api_key', email: null, orgName: null, subscriptionType: null }
    const view = { active: '', accounts: [
      account('keyed', { apiKey: true, keyReplaceable: true, status: key }),
      account('refused', { apiKey: true, keyReplaceable: true, needsLogin: true, status: key }),
      account('keyless', { status: { ...key, loggedIn: false, authMethod: null } }),
    ] } as unknown as AccountView
    expect(chatOptions(view).accounts.map((each) => each.key)).toEqual(['keyed'])
  })

  it('keeps an account on a limit: it waits, greyed with its reset', () => {
    const view = { active: '', accounts: [account('open'), spent] } as unknown as AccountView
    expect(chatOptions(view).accounts.map((each) => each.key)).toEqual(['open', 'spent'])
  })
})
