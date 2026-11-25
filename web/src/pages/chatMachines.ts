import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import { hubFolderOf } from '../../../src/account/same-account.js'
import type { ChatMachine, ChatMachines } from '../../../src/chats/model.js'

/** The machines the "New session" window lets the user pick from (BTN-1614): none while there is only one. */
export const machineChoices = (answer: ChatMachines | null): ChatMachine[] => (answer !== null && answer.machines.length > 1 ? answer.machines : [])

/**
 * The accounts panel of the machine: the own one's is the page's live one, one elsewhere's comes with the answer, each
 * account named as the hub names the same e-mail (`hubFolderOf`), as the machine's accounts panel does (BTN-1670).
 * `undefined` — not read yet. Without the answer or a machine named, the own one's.
 */
export function machinePanel(answer: ChatMachines | null, machine: string | null, own: AccountView | undefined): AccountView | undefined {
  const picked = answer?.machines.find((each) => each.id === machine)
  if (picked === undefined || picked.own) return own
  if (picked.accounts === null) return undefined
  const hub = own?.accounts ?? []
  return {
    ...picked.accounts,
    accounts: picked.accounts.accounts.map((entry) => {
      const email = entry.status?.email ?? entry.longToken?.account?.email ?? entry.lastEmail ?? null
      const match = hubFolderOf(hub, entry.agent, email)
      return match === undefined ? entry : { ...entry, name: match.name }
    }),
  }
}

/**
 * The accounts a new chat can start on: signed in on the machine, a refused key counting as signed out
 * (`needsLogin`), and not being removed. One on a limit stays: it only waits (`blockOf`).
 */
export const chatOptions = (view: AccountView): AccountView => ({
  ...view,
  accounts: view.accounts.filter((entry) => !entry.needsLogin && !entry.removing && entry.status !== null && entry.status.loggedIn !== false),
})

/** The account kept after the machine changed: the current one where it is open there, else the last choice's, else the first open. */
export const accountAfter = (open: readonly AccountEntry[], current: string, preferred: string | undefined): AccountEntry | undefined =>
  open.find((entry) => entry.key === current) ?? open.find((entry) => entry.key === preferred) ?? open[0]

/**
 * The accounts a chat may go on with in a new session: its own machine's, since the history stays there. The hub's
 * own machine (or no machine told, an older service) — the page's live accounts; one elsewhere — from the answer,
 * `undefined` until it comes, none when the machine is not in it or has not told its accounts.
 */
export function chatAccounts(answer: ChatMachines | null, machine: string | undefined, ownMachine: string | undefined, own: AccountView | undefined): AccountEntry[] | undefined {
  if (machine === undefined || machine === ownMachine) return own?.accounts ?? []
  if (answer === null) return undefined
  return answer.machines.find((each) => each.id === machine && !each.own)?.accounts?.accounts ?? []
}
