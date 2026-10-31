import type { AccountEntry, AccountView } from '../../src/account/model.js'
import { PROVIDERS as RUN_PROVIDERS } from '../../src/agent/providers.js'
import { CLAUDE } from '../../src/claude/name.js'
import { CODEX } from '../../src/codex/name.js'
import { COPILOT } from '../../src/copilot/name.js'
import { limitSpans, type LimitSpan, type LimitWindow, type RateLimits } from '../../src/limits/model.js'
import { OPENCODE } from '../../src/opencode/name.js'
import { accountOrder } from './state.js'
import { copilotOnly } from '../../src/opencode/support.js'

const SERIES = 8

/** The series colour (1–8) of the account with this e-mail: by the order of the folder keys, so it is the same on every page. */
export function accountSlot(view: AccountView | undefined, email: string): number | null {
  if (view === undefined) return null
  const owner = view.accounts.find((entry) => entry.status?.email === email)
  if (owner === undefined) return null
  const keys = view.accounts.map((entry) => entry.key).sort()
  return (keys.indexOf(owner.key) % SERIES) + 1
}

/** Whether a session ran on an account other than the one its project runs on: only then the chain's row names it. */
export function foreignAccount(view: AccountView | undefined, project: string, email: string | null | undefined): boolean {
  if (email == null) return false
  return !(view?.accounts.some((entry) => entry.status?.email === email && entry.projects.includes(project)) ?? false)
}

/** The series colour of an account folder: by its e-mail, so sessions and cards agree; by its key when it has none. */
export function entrySlot(view: AccountView, entry: AccountEntry): number {
  const email = entry.status?.email ?? null
  const byEmail = email === null ? null : accountSlot(view, email)
  if (byEmail !== null) return byEmail
  const keys = view.accounts.map((each) => each.key).sort()
  return (keys.indexOf(entry.key) % SERIES) + 1
}

/** Whose account it is: the agents of `src/agent/adapters.ts` and the ones the page only names for now. */
export const PROVIDERS = ['claude', 'codex', 'opencode', 'copilot'] as const
export type Provider = (typeof PROVIDERS)[number]

/** How the account signs in: through the agent's CLI or with an API key. */
export type Connection = 'cli' | 'apiKey'

export function connectionOf(entry: AccountEntry): Connection {
  return entry.apiKey ? 'apiKey' : 'cli'
}

/**
 * What the account reaches the models through and who bills it, the group of the accounts page inside an agent's block
 * (BTN-576). Keys of different providers are different groups; the plan (pro, max, free) does not split one.
 */
export const ACCESSES = ['zen', 'claudeSubscription', 'chatgpt', 'github', 'anthropicKey', 'openaiKey', 'other'] as const
export type Access = (typeof ACCESSES)[number]

export type Owner = 'anthropic' | 'openai' | 'zen' | 'github'

/** Who bills a connection, the colour of its group's stripe; none for an agent the page does not know. */
export const ACCESS_OWNER: Record<Access, Owner | null> = {
  claudeSubscription: 'anthropic',
  anthropicKey: 'anthropic',
  chatgpt: 'openai',
  openaiKey: 'openai',
  zen: 'zen',
  github: 'github',
  other: null,
}

/**
 * An OpenCode folder holds several providers: it is grouped by the one whose limits it shows (`openCodeUsage`: ChatGPT,
 * then Copilot), a key folder by the key's provider; one with neither runs OpenCode Zen.
 */
export function accessOf(entry: AccountEntry): Access {
  if (entry.agent === COPILOT) return 'github'
  if (entry.agent === CLAUDE) return entry.apiKey ? 'anthropicKey' : 'claudeSubscription'
  if (entry.agent === CODEX) return entry.apiKey ? 'openaiKey' : 'chatgpt'
  if (entry.agent !== OPENCODE) return 'other'
  const held = entry.status?.subscriptionType?.split(',').map((name) => name.trim()) ?? []
  if (entry.apiKey) return held.includes('anthropic') ? 'anthropicKey' : held.includes('openai') ? 'openaiKey' : 'zen'
  if (held.includes('openai')) return 'chatgpt'
  if (held.includes('github-copilot')) return 'github'
  return held.includes('anthropic') ? 'claudeSubscription' : 'zen'
}

export interface AccessGroup {
  access: Access
  entries: AccountEntry[]
}

/** One agent's accounts by connection, in the order of `ACCESSES`, each keeping the order it was given. */
export function accessGroups(entries: AccountEntry[]): AccessGroup[] {
  return ACCESSES.map((access) => ({ access, entries: entries.filter((entry) => accessOf(entry) === access) })).filter((group) => group.entries.length > 0)
}

/**
 * Whether the running sign-in is a device sign-in, Codex's or OpenCode's: the one-time code from its output goes on the
 * sign-in page, nothing is typed here.
 */
export function deviceLogin({ login }: AccountView): boolean {
  return login?.agent === CODEX || login?.agent === OPENCODE
}

/** Whether the service does not find the provider's CLI: no account of it is added, the page says where to get it. */
export function cliMissing(view: AccountView, provider: Provider): boolean {
  return view.missing.includes(provider)
}

/** What the page says of a provider whose CLI is not found: where to get it. */
export const CLI_MISSING = { claude: 'login.claudeMissing', codex: 'login.codexMissing', opencode: 'login.opencodeMissing', copilot: 'login.copilotMissing' } as const

/**
 * The providers a project's or the shared settings offer to run on: the ones with an account, and any a setting there
 * already names (`named`); every one until the accounts are known.
 */
export function offeredProviders(view: AccountView | null, named: string[]): string[] {
  if (view === null) return [...RUN_PROVIDERS]
  return RUN_PROVIDERS.filter((provider) => named.includes(provider) || view.accounts.some((entry) => entry.agent === provider))
}

export interface AccountGroup {
  agent: string
  entries: AccountEntry[]
}

/**
 * Populated providers only, in provider order. Accounts at work precede idle ones, with the active account first.
 */
export function accountGroups(view: AccountView, now: Date): AccountGroup[] {
  const ordered = accountOrder(view.accounts, now)
  const sorted = [...ordered].sort((a, b) => Number(b.key === view.active) - Number(a.key === view.active) || Number(atWork(view, b)) - Number(atWork(view, a)))
  const known: string[] = [...PROVIDERS]
  const agents = [...known, ...new Set(sorted.map((entry) => entry.agent).filter((agent) => !known.includes(agent)))]
  const groups = agents.map((agent) => ({ agent, entries: sorted.filter((entry) => entry.agent === agent) }))
  return groups.filter((group) => group.entries.length > 0)
}

/** Whether anything works on the account: the Even Keel role, an app, a project's pool entry or a running session. */
export function atWork(view: AccountView, entry: AccountEntry): boolean {
  return (
    view.active === entry.key ||
    view.apps.some((app) => app.account === entry.key) ||
    entry.projects.length > 0 ||
    entry.sessions.length > 0
  )
}

export interface Tightest {
  span: LimitSpan
  /** What is left of the window, a whole percent within 0–100. */
  free: number
  window: LimitWindow
}

/**
 * The window with the least left: what an account can still take, as one number; null without a window with data. A
 * window that only counts what was spent (`used`) has no share left to compare.
 */
export function tightestWindow(limits: RateLimits | null): Tightest | null {
  let tightest: Tightest | null = null
  for (const span of limitSpans(limits)) {
    const window = limits?.[span] ?? null
    if (window === null || window.used !== undefined) continue
    const free = Math.round(100 - Math.min(Math.max(window.usedPercentage, 0), 100))
    if (tightest === null || free < tightest.free) tightest = { span, free, window }
  }
  return tightest
}

/** How ready a provider is to run sessions on the account folder its pool entry names (BTN-310). */
export type Readiness = { state: 'cliMissing' } | { state: 'noAccount' } | { state: 'signIn' | 'ready' | 'unsupported'; entry: AccountEntry }

export function readinessOf(view: AccountView, provider: string, key: string): Readiness {
  if (view.missing.includes(provider)) return { state: 'cliMissing' }
  const entry = view.accounts.find((each) => each.key === key && each.agent === provider)
  if (entry === undefined) return { state: 'noAccount' }
  if (copilotOnly(entry)) return { state: 'unsupported', entry }
  return { state: entry.needsLogin ? 'signIn' : 'ready', entry }
}
