import { describe, expect, it, vi } from 'vitest'
import type { AccountEntry, AccountView } from '../account/model.js'
import { NoticeError } from '../notice/notice.js'
import { machineAccountCommands, type MachineAccountDeps } from './machine-account-commands.js'

const entry = (key: string, email: string | null, patch: Partial<AccountEntry> = {}) =>
  ({ key, agent: 'claude', name: null, status: { loggedIn: true, email }, needsLogin: false, ...patch }) as unknown as AccountEntry

const view = (accounts: AccountEntry[], active = ''): AccountView => ({ accounts, active, login: null, loginBlock: null, apps: [], pool: [], missing: [] }) as unknown as AccountView

function setup(patch: Partial<MachineAccountDeps> = {}) {
  const machine = {
    remove: vi.fn(async () => {}), keep: vi.fn(), switchApp: vi.fn(async () => {}), rename: vi.fn(),
    addApiKey: vi.fn(async () => {}), replaceApiKey: vi.fn(async () => {}),
  }
  const hub = { rename: vi.fn(), switchTo: vi.fn() }
  const deps: MachineAccountDeps = {
    online: () => true,
    control: async () => machine,
    panel: () => view([entry('work', 'john@example.com'), entry('key-1', null, { apiKey: true, keyReplaceable: true, agent: 'codex' }), entry('only-here', 'jane@example.com')]),
    name: () => 'Example laptop',
    hubView: () => view([entry('hub-token', 'john@example.com', { longToken: {} as never }), entry('hub-work', 'JOHN@example.com')], 'hub-token'),
    hub,
    log: () => {},
    ...patch,
  }
  return { commands: machineAccountCommands(deps), machine, hub }
}

const codeOf = async (run: Promise<unknown>) => {
  try {
    await run
  } catch (error) {
    return error instanceof NoticeError ? error.notice.code : String(error)
  }
  return null
}

describe('machineAccountCommands', () => {
  it("removes the machine's folder there: the machine waits for its sessions itself", async () => {
    const { commands, machine } = setup()
    await commands.remove('laptop', 'work')
    expect(machine.remove).toHaveBeenCalledWith('work')
    await commands.keep('laptop', 'work')
    expect(machine.keep).toHaveBeenCalledWith('work')
  })

  it('refuses every command while the machine is off the link, before anything is sent', async () => {
    const { commands, machine, hub } = setup({ online: () => false })
    expect(await codeOf(commands.remove('laptop', 'work'))).toBe('machines.accountsOffline')
    expect(await codeOf(commands.rename('laptop', 'work', 'Work'))).toBe('machines.accountsOffline')
    expect(await codeOf(commands.switchTo('laptop', 'work'))).toBe('machines.accountsOffline')
    expect(machine.remove).not.toHaveBeenCalled()
    expect(hub.rename).not.toHaveBeenCalled()
  })

  it("points the machine's VS Code at its folder", async () => {
    const { commands, machine } = setup()
    await commands.app('laptop', 'vscode', 'work')
    expect(machine.switchApp).toHaveBeenCalledWith('vscode', 'work')
  })

  it("renames an account with an e-mail the hub has as the hub's folder, so every machine shows the name", async () => {
    const { commands, machine, hub } = setup()
    await commands.rename('laptop', 'work', 'Work')
    expect(hub.rename).toHaveBeenCalledWith('hub-work', 'Work')
    expect(machine.rename).not.toHaveBeenCalled()
  })

  it("renames a key folder, or an account the hub lacks, only in the machine's folder", async () => {
    const { commands, machine, hub } = setup()
    await commands.rename('laptop', 'key-1', 'Key')
    await commands.rename('laptop', 'only-here', 'Jane')
    expect(machine.rename.mock.calls).toEqual([['key-1', 'Key'], ['only-here', 'Jane']])
    expect(hub.rename).not.toHaveBeenCalled()
  })

  it("makes the hub's folder of the same account Even Keel's, the level every machine maps to its own folder", async () => {
    const { commands, hub } = setup()
    await commands.switchTo('laptop', 'work')
    expect(hub.switchTo).toHaveBeenCalledWith('hub-work')
  })

  it('refuses Even Keel for an account the hub has no folder of', async () => {
    const { commands, hub } = setup()
    expect(await codeOf(commands.switchTo('laptop', 'only-here'))).toBe('machines.accountNotOnHub')
    expect(await codeOf(commands.switchTo('laptop', 'key-1'))).toBe('machines.accountNotOnHub')
    expect(hub.switchTo).not.toHaveBeenCalled()
  })

  it("refuses a folder the machine's panel does not list", async () => {
    const { commands } = setup()
    expect(await codeOf(commands.rename('laptop', 'missing', 'X'))).toBe('account.unknown')
    expect(await codeOf(commands.key('laptop', { agent: 'claude', key: 'sk-ant-api03-fake', name: '', folder: 'missing' }))).toBe('account.unknown')
  })

  describe('an API key for the machine (BTN-1684)', () => {
    const KEY = 'sk-ant-api03-fake-fake-fake-fake-fake'

    it('adds a new key folder there, the key in the command alone and never in the log', async () => {
      const lines: string[] = []
      const { commands, machine } = setup({ log: (line) => void lines.push(line) })
      await commands.key('laptop', { agent: 'opencode', key: 'sk-or-v1-fake-fake-fake-fake', name: 'Router' })
      expect(machine.addApiKey).toHaveBeenCalledWith('Router', 'sk-or-v1-fake-fake-fake-fake', 'opencode')
      expect(lines.join(' ')).toContain('laptop')
      expect(lines.join(' ')).not.toContain('sk-or-v1')
    })

    it('puts the key into a folder that keeps one of its own, under its agent', async () => {
      const { commands, machine } = setup()
      await commands.key('laptop', { agent: 'codex', key: KEY, name: '', folder: 'key-1' })
      expect(machine.replaceApiKey).toHaveBeenCalledWith('key-1', KEY)
      expect(machine.addApiKey).not.toHaveBeenCalled()
    })

    it("makes a folder that keeps no key a new key folder of its agent, named after it", async () => {
      const { commands, machine } = setup()
      await commands.key('laptop', { agent: 'codex', key: KEY, name: '', folder: 'work' })
      expect(machine.addApiKey).toHaveBeenCalledWith('work', KEY, 'claude')
      expect(machine.replaceApiKey).not.toHaveBeenCalled()
    })

    it('refuses while the machine is off the link', async () => {
      const { commands, machine } = setup({ online: () => false })
      expect(await codeOf(commands.key('laptop', { agent: 'claude', key: KEY, name: '' }))).toBe('machines.accountsOffline')
      expect(machine.addApiKey).not.toHaveBeenCalled()
    })
  })
})
