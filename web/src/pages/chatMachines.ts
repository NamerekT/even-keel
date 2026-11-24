import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import type { ChatMachine, ChatMachines } from '../../../src/chats/model.js'

/** The machines the "New session" window lets the user pick from (BTN-1614): none while there is only one. */
export const machineChoices = (answer: ChatMachines | null): ChatMachine[] => (answer !== null && answer.machines.length > 1 ? answer.machines : [])

/**
 * The accounts panel of the machine: the own one's is the page's live one, one elsewhere's comes with the answer.
 * `undefined` — not read yet. Without the answer or a machine named, the own one's.
 */
export function machinePanel(answer: ChatMachines | null, machine: string | null, own: AccountView | undefined): AccountView | undefined {
  const picked = answer?.machines.find((each) => each.id === machine)
  if (picked === undefined || picked.own) return own
  return picked.accounts ?? undefined
}

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
