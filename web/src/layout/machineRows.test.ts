import { describe, expect, it, vi } from 'vitest'
import type { AccountEntry } from '../../../src/account/model.js'
import type { MachineCard } from '../../../src/state.js'
import type { MachineAccounts } from '../machineAccountView.js'
import { machineSend, machineSwitchOff } from './machineRows.js'

describe('machineSend', () => {
  const folders = new Map([['view-john', 'john-folder']])

  it('sends a row menu command as the machine\'s, naming its folder of the row', async () => {
    const send = vi.fn(async () => true)
    await expect(machineSend(send, 'pc', folders)('account/name', { account: 'view-john', name: 'Work' })).resolves.toBe(true)
    expect(send).toHaveBeenCalledWith('machines/account/name', { machine: 'pc', account: 'john-folder', name: 'Work' })
  })

  it.each(['remove', 'keep', 'app', 'switch'])('maps account/%s to the machine command', async (command) => {
    const send = vi.fn(async () => true)
    await machineSend(send, 'pc', folders)(`account/${command}`, { account: 'view-john', app: 'vscode' })
    expect(send).toHaveBeenCalledWith(`machines/account/${command}`, { machine: 'pc', account: 'john-folder', app: 'vscode' })
  })

  it('sends nothing for a row with no folder on the machine', async () => {
    const send = vi.fn(async () => true)
    await expect(machineSend(send, 'pc', folders)('account/remove', { account: 'hub-only' })).resolves.toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('sends nothing for a command the machine does not take', async () => {
    const send = vi.fn(async () => true)
    await expect(machineSend(send, 'pc', folders)('account/remote', { account: 'view-john' })).resolves.toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('machineSwitchOff', () => {
  const entry = (key: string, email: string | null): AccountEntry => ({ key, agent: 'claude', status: email === null ? null : { email } }) as unknown as AccountEntry
  const accounts = (hubFolders: Map<string, string>): MachineAccounts => ({
    view: { accounts: [entry('view-john', 'john@example.com'), entry('view-key', null)] },
    away: new Map(), here: new Map(), folders: new Map([['view-john', 'john-folder'], ['view-key', 'key-folder']]), hubFolders,
  }) as unknown as MachineAccounts
  const card = { id: 'pc', name: 'Office PC' } as MachineCard

  it('lets Even Keel move to an account the hub has a folder of', () => {
    expect(machineSwitchOff(accounts(new Map([['view-john', 'hub-john']])), card)('view-john')).toBeUndefined()
  })

  it('names the account the hub lacks by its e-mail, else by the machine\'s folder', () => {
    const off = machineSwitchOff(accounts(new Map()), card)
    expect(off('view-john')).toEqual({ code: 'machines.accountNotOnHub', params: { name: 'Office PC', account: 'john@example.com' } })
    expect(off('view-key')).toEqual({ code: 'machines.accountNotOnHub', params: { name: 'Office PC', account: 'key-folder' } })
  })
})
