import type { AccountEntry, AccountView } from '../../src/account/model.js'
import type { RateLimits } from '../../src/limits/model.js'
import type { MachineCard, MachineCardAccount } from '../../src/state.js'
import { sameEmail } from './machineSignIn.js'

/** A machine an account of the header's window is signed in on. */
export interface HeaderMachine {
  id: string
  name: string
  color: string
  /** Only on a long token there: no Remote Control. */
  token: boolean
}

/** One account of the header's accounts window in "All machines" (BTN-1309): an agent and an e-mail, wherever it is. */
export interface HeaderAccount {
  id: string
  agent: string
  email: string | null
  /** The folder it was first found in, to name it where it has no e-mail. */
  key: string
  /** The hub's folder of it, for its colour and name; absent — it is only on machines elsewhere. */
  entry?: AccountEntry
  /** The limits of the first machine that read them, the hub first: a limit is the account's, not a machine's. */
  limits: RateLimits | null
  machines: HeaderMachine[]
}

const identity = (card: MachineCard, account: MachineCardAccount): string =>
  account.email === null ? `${account.agent}:${card.id}/${account.key}` : `${account.agent}:${account.email.toLowerCase()}`

/**
 * The accounts Even Keel uses on any machine — the hub's launch account and its pools' folders, each machine
 * elsewhere's launch account — one block each, with the machines it is signed in on. The rest are on the accounts page.
 */
export function headerAccounts(cards: MachineCard[], view: AccountView): HeaderAccount[] {
  const blocks = new Map<string, HeaderAccount>()
  for (const card of cards) {
    const used = card.own ? new Set([view.active, ...view.pool.map((each) => each.account)]) : new Set([card.active])
    for (const account of card.accounts.filter((each) => used.has(each.key))) {
      const id = identity(card, account)
      if (blocks.has(id)) continue
      const entry = card.own ? view.accounts.find((each) => each.key === account.key) : view.accounts.find((each) =>
        each.agent === account.agent && each.longToken === undefined && sameEmail(each.status?.email ?? each.lastEmail ?? null, account.email))
      blocks.set(id, { id, agent: account.agent, email: account.email, key: account.key, ...(entry !== undefined && { entry }), limits: null, machines: [] })
    }
  }
  for (const card of cards) {
    for (const account of card.accounts.filter((each) => each.signedIn)) {
      const block = blocks.get(identity(card, account))
      if (block === undefined) continue
      block.limits ??= account.limits
      const known = block.machines.find((each) => each.id === card.id)
      if (known !== undefined) known.token &&= account.longToken === true
      else block.machines.push({ id: card.id, name: card.name, color: card.color, token: account.longToken === true })
    }
  }
  return [...blocks.values()]
}
