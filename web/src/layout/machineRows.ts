import type { ReactNode } from 'react'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import { notice, type Notice } from '../../../src/notice/notice.js'
import type { Send } from './accountParts.js'
import type { MachineCard } from '../../../src/state.js'
import { entrySlot } from '../accounts.js'
import type { MachineAccounts, MachineAway, MachineUse } from '../machineAccountView.js'
import { sameEmail } from '../machineSignIn.js'

/**
 * A machine elsewhere's view in the hub's account blocks (BTN-1570): the header's levels, the drawer and the page's
 * table show its accounts and limits; their rows hold no control of the hub's folders, only "Sign in" there.
 */
export interface MachineRows extends MachineAccounts {
  card: MachineCard
  /** By key of the view: where the machine takes the account, as "Used by". */
  uses: Map<string, MachineUse[]>
  /** The "Sign in" on the machine of a row it is not signed in to. */
  signIn: (away: MachineAway) => ReactNode
  /** The hub's own view: an account keeps the colour it has on the hub's pages. */
  hub: AccountView
  /** A command or a sign-in is under way there. */
  busy: boolean
  /** It is on the link: its sign-ins can run. */
  online: boolean
  /** "Add account" can not open now: busy, off the link, or the hub's own sign-in is under way. */
  addOff: boolean
  failure: Notice | null
  /** The row menu's commands, each sent as the machine's (`machineSend`, BTN-1584). */
  send: Send
  /** Why Even Keel can not move to a row: the hub has no folder of its account. */
  switchOff: (key: string) => Notice | undefined
}

/** A row menu's `account/*` command and the hub's command that does it on the machine (BTN-1584). */
const MACHINE_COMMANDS: Readonly<Record<string, string>> = {
  'account/remove': 'machines/account/remove',
  'account/keep': 'machines/account/keep',
  'account/app': 'machines/account/app',
  'account/name': 'machines/account/name',
  'account/switch': 'machines/account/switch',
}

/**
 * The row menu's `send` in a machine's view: each command the machine's, naming its folder of the row; any other, or a
 * row with no folder there (a hub subscription not signed in there), is not sent.
 */
export function machineSend(send: Send, machine: string, folders: ReadonlyMap<string, string>): Send {
  return (name, body = {}) => {
    const command = MACHINE_COMMANDS[name]
    const folder = typeof body.account === 'string' ? folders.get(body.account) : undefined
    if (command === undefined || folder === undefined) return Promise.resolve(false)
    return send(command, { ...body, machine, account: folder })
  }
}

/** Even Keel's account is the hub's: a machine's account the hub has no folder of can not take it (`docs/accounts.md`). */
export function machineSwitchOff(accounts: MachineAccounts, card: MachineCard): (key: string) => Notice | undefined {
  return (key) => {
    if (accounts.hubFolders.has(key)) return undefined
    const entry = accounts.view.accounts.find((each) => each.key === key)
    return notice('machines.accountNotOnHub', { name: card.name, account: entry?.status?.email ?? accounts.folders.get(key) ?? key })
  }
}

/** The series colour of an account's row: in a machine's view the hub's of the same e-mail, none for one the hub lacks. */
export function rowSlot(view: AccountView, entry: AccountEntry, machine: MachineRows | undefined): number | null {
  if (machine === undefined) return entrySlot(view, entry)
  const email = entry.status?.email ?? null
  const owner = machine.hub.accounts.find((each) => each.agent === entry.agent && sameEmail(each.status?.email ?? null, email))
  return owner === undefined ? null : entrySlot(machine.hub, owner)
}
