import { accountAt } from '../account/ledger.js'
import type { AccountView } from '../account/model.js'
import type { RateLimits } from '../limits/model.js'
import type { UsageHealth } from '../limits/usage.js'
import type { SessionMail } from '../sessions/mail.js'
import type { SessionView } from '../state.js'
import type { MachineFacts } from './facts.js'

const WAITING: UsageHealth = { state: 'waiting', reason: null, since: null }

/**
 * What the hub's page and chat read of a machine's sessions and accounts, all from its mirror (`docs/machines.md`,
 * "The mirror"): never older than the machine's last post, and nothing before its first snapshot.
 */
export interface PageReads {
  sessions(): SessionView[]
  mailbox(): Record<string, SessionMail>
  /** The task's session that is not finished. */
  liveView(task: string): SessionView | undefined
  /** A message goes into the live session mid-turn without its mailbox (`AgentEntry.steers`). */
  steers(sessionId: string): boolean
  /** The accounts panel; `undefined` before the first snapshot or on a machine with no account watcher. */
  panel(): AccountView | undefined
  limits(account: string): RateLimits | null
  usage(account: string): UsageHealth
  /** Whether the machine has the account folder `key` and it belongs to `provider`. */
  hasAccount(provider: string, key: string): boolean
  /** The account folder of a session: its agent's, else the one its transcript is in. */
  ownerOf(sessionId: string): string | undefined
  /** The e-mail the session ran as: a live one's own, else its folder's at `at` (the folder's account may change). */
  sessionAccount(sessionId: string | null, at: string | null): string | null
  compactionsOf(sessionId: string): number
}

export function pageReads(facts: () => MachineFacts | undefined): PageReads {
  const sessions = (): SessionView[] => Object.values(facts()?.sessions ?? {})
  const entryOf = (key: string) => facts()?.panel?.accounts.find((entry) => entry.key === key)
  const emailAt = (key: string, at: string | null): string | null =>
    (at === null ? null : accountAt({ accounts: facts()?.ledger ?? {}, removing: [] }, key, at)) ?? entryOf(key)?.status?.email ?? null
  return {
    sessions,
    mailbox: () => facts()?.mailbox ?? {},
    liveView: (task) => sessions().find((view) => view.task === task && view.lamp !== 'finished'),
    steers: (sessionId) => facts()?.mailbox?.[sessionId]?.steers === true,
    panel: () => facts()?.panel,
    limits: (account) => facts()?.limits[account] ?? null,
    usage: (account) => facts()?.usage?.[account] ?? WAITING,
    hasAccount: (provider, key) => entryOf(key)?.agent === provider,
    ownerOf: (sessionId) => facts()?.owners?.[sessionId],
    sessionAccount: (sessionId, at) => {
      if (sessionId === null) return null
      const live = facts()?.sessions?.[sessionId]
      if (live !== undefined) return live.account
      const key = facts()?.owners?.[sessionId]
      return key === undefined ? null : emailAt(key, at)
    },
    compactionsOf: (sessionId) => facts()?.compactions?.[sessionId] ?? 0,
  }
}
