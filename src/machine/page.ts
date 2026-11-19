import { accountAt } from '../account/ledger.js'
import type { AccountView } from '../account/model.js'
import type { RateLimits } from '../limits/model.js'
import type { UsageHealth } from '../limits/usage.js'
import type { SessionMail } from '../sessions/mail.js'
import type { FoundRepository, SessionView, TaskWork } from '../state.js'
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
  /**
   * The agent the session ran on: a live one's own, else its folder's; null once the folder is gone. An e-mail alone does
   * not tell it: one address may be signed in to two agents (BTN-1341).
   */
  sessionAgent(sessionId: string): string | null
  compactionsOf(sessionId: string): number
  /** By project and task, what the task's working folder holds. */
  works(): Record<string, Record<string, TaskWork>>
  /** By project without git, the repository its folder has become. */
  gitFound(): Record<string, FoundRepository>
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
    sessionAgent: (sessionId) => {
      const live = facts()?.sessions?.[sessionId]
      if (live !== undefined) return live.agent
      const key = facts()?.owners?.[sessionId]
      return (key === undefined ? undefined : entryOf(key)?.agent) ?? null
    },
    compactionsOf: (sessionId) => facts()?.compactions?.[sessionId] ?? 0,
    works: () => facts()?.works ?? {},
    gitFound: () => facts()?.gitFound ?? {},
  }
}

/** What the page's state reads of the sessions of every machine on the hub (BTN-1314). */
export type SessionReads = Pick<PageReads, 'sessions' | 'sessionAccount' | 'sessionAgent' | 'compactionsOf'>

/**
 * The sessions of all the mirrors, the own machine's first: a task a machine elsewhere runs has its session, its
 * start and its lamp on the page as one of the hub's. A session two mirrors show is the first one's.
 */
export function allSessions(pages: () => PageReads[]): SessionReads {
  return {
    sessions: () => {
      const seen = new Set<string>()
      return pages().flatMap((page) => page.sessions()).filter((view) => !seen.has(view.sessionId) && seen.add(view.sessionId))
    },
    sessionAccount: (sessionId, at) => {
      for (const page of pages()) {
        const account = page.sessionAccount(sessionId, at)
        if (account !== null) return account
      }
      return null
    },
    sessionAgent: (sessionId) => {
      for (const page of pages()) {
        const agent = page.sessionAgent(sessionId)
        if (agent !== null) return agent
      }
      return null
    },
    compactionsOf: (sessionId) => {
      for (const page of pages()) {
        const compactions = page.compactionsOf(sessionId)
        if (compactions > 0) return compactions
      }
      return 0
    },
  }
}
