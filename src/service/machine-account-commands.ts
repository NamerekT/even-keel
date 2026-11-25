import type { AccountView } from '../account/model.js'
import { hubFolderOf } from '../account/same-account.js'
import { fail } from '../notice/notice.js'
import type { AccountControl } from '../server-control.js'
import { machineAccountOf } from './machine-page.js'

export interface MachineAccountDeps {
  online(machine: string): boolean
  /** The machine's own `AccountControl` through the link; refuses a machine unknown or revoked. */
  control(machine: string): Promise<Pick<AccountControl, 'remove' | 'keep' | 'switchApp' | 'rename' | 'addApiKey' | 'replaceApiKey'>>
  /** The machine's accounts panel as its last snapshot posted it; `undefined` — none since the hub started. */
  panel(machine: string): AccountView | undefined
  name(machine: string): string
  /** The hub's own accounts panel. */
  hubView(): AccountView
  hub: Pick<AccountControl, 'rename' | 'switchTo'>
  log(line: string): void
}

/**
 * What a machine elsewhere's view does with its accounts (BTN-1584, `docs/accounts.md`, "A machine's accounts"): each
 * names the machine's folder. Removing, keeping and VS Code run on the machine, its own guards refusing there; the name
 * and Even Keel's account of an account the hub has are the hub's folder's, one for the hub and every machine.
 */
export interface MachineAccountCommands {
  remove(machine: string, account: string): Promise<void>
  keep(machine: string, account: string): Promise<void>
  app(machine: string, app: string, account: string): Promise<void>
  rename(machine: string, account: string, name: string): Promise<void>
  switchTo(machine: string, account: string): Promise<void>
  /**
   * An API key for the machine (BTN-1684), kept in its folder there as the hub keeps its own and checked there with the
   * provider: into `folder` when that folder keeps a key of its own, else in a new folder of that folder's agent and
   * name, or of `agent` and `name`. The key goes only as the command's payload, never into the log.
   */
  key(machine: string, given: MachineKey): Promise<void>
}

export interface MachineKey {
  agent: string
  key: string
  name: string
  /** The machine's folder the key is entered from: its row signed out. */
  folder?: string
}

export function machineAccountCommands(deps: MachineAccountDeps): MachineAccountCommands {
  const control = async (machine: string) => {
    if (!deps.online(machine)) throw fail('machines.accountsOffline', { name: deps.name(machine) })
    return deps.control(machine)
  }
  const folder = (machine: string, account: string) => {
    const entry = deps.panel(machine)?.accounts.find((each) => each.key === account)
    if (entry === undefined) throw fail('account.unknown', { key: account })
    const { email } = machineAccountOf(entry)
    return { email, hub: hubFolderOf(deps.hubView().accounts, entry.agent, email) }
  }
  return {
    async remove(machine, account) {
      const there = await control(machine)
      deps.log(`machines: the account folder ${account} is removed on machine ${machine} once its sessions there end`)
      await there.remove(account)
    },
    async keep(machine, account) {
      await (await control(machine)).keep(account)
    },
    async app(machine, app, account) {
      const there = await control(machine)
      deps.log(`machines: ${app} on machine ${machine} is pointed at its account folder ${account}`)
      await there.switchApp(app, account)
    },
    async rename(machine, account, name) {
      const there = await control(machine)
      const { hub } = folder(machine, account)
      if (hub === undefined) await there.rename(account, name)
      else deps.hub.rename(hub.key, name)
    },
    async switchTo(machine, account) {
      await control(machine)
      const { email, hub } = folder(machine, account)
      if (hub === undefined) throw fail('machines.accountNotOnHub', { name: deps.name(machine), account: email ?? account })
      deps.log(`machines: Even Keel's account moves to the hub's folder ${hub.key}, the account of folder ${account} on machine ${machine}`)
      deps.hub.switchTo(hub.key)
    },
    async key(machine, { agent, key, name, folder }) {
      const there = await control(machine)
      const entry = folder === undefined ? undefined : deps.panel(machine)?.accounts.find((each) => each.key === folder)
      if (folder !== undefined && entry === undefined) throw fail('account.unknown', { key: folder })
      if (entry !== undefined && machineAccountOf(entry).keyReplaceable === true) {
        deps.log(`machines: a new API key goes into the account folder ${entry.key} on machine ${machine}`)
        await there.replaceApiKey(entry.key, key)
        return
      }
      const of = entry?.agent ?? agent
      deps.log(`machines: an API account of ${of} is added on machine ${machine}`)
      await there.addApiKey(name.trim() === '' ? (folder ?? '') : name, key, of)
    },
  }
}
