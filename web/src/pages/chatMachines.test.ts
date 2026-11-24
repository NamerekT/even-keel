import { describe, expect, it } from 'vitest'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import type { ChatMachines } from '../../../src/chats/model.js'
import { accountAfter, chatAccounts, machineChoices, machinePanel } from './chatMachines.js'

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
