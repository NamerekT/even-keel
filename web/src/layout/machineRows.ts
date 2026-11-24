import type { ReactNode } from 'react'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import type { Notice } from '../../../src/notice/notice.js'
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
}

/** The series colour of an account's row: in a machine's view the hub's of the same e-mail, none for one the hub lacks. */
export function rowSlot(view: AccountView, entry: AccountEntry, machine: MachineRows | undefined): number | null {
  if (machine === undefined) return entrySlot(view, entry)
  const email = entry.status?.email ?? null
  const owner = machine.hub.accounts.find((each) => each.agent === entry.agent && sameEmail(each.status?.email ?? null, email))
  return owner === undefined ? null : entrySlot(machine.hub, owner)
}
