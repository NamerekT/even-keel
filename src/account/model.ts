import type { ActiveChain } from '../chain/dispatcher.js'
import type { RateLimits } from '../limits/model.js'
import type { UsageHealth } from '../limits/usage.js'
import { fail, notice, type Notice } from '../notice/notice.js'
import { CLAUDE } from '../claude/name.js'
import { CODEX } from '../codex/name.js'
import { COPILOT } from '../copilot/name.js'
import { OPENCODE } from '../opencode/name.js'
import { isLive, type AgentEntry } from '../sessions/agents.js'
import { APP_LABELS, type AppAccount } from './apps.js'
import type { Transport } from './transport.js'

export const GLOBAL_ACCOUNT = 'global'
/** The key of Codex's own account folder, `CODEX_HOME` or `~/.codex` (`AccountHomes`). */
export const CODEX_ACCOUNT = 'codex'
/** ChatGPT's `chatgpt_plan_type` of an account without a subscription. */
const FREE_PLAN = 'free'

/** What an account folder is signed in as, by its agent (`Agent.authStatus`). */
export interface AccountStatus {
  loggedIn: boolean
  authMethod: string | null
  email: string | null
  orgName: string | null
  subscriptionType: string | null
}

export interface CredentialTimes {
  accessExpiresAt: number | null
  loginExpiresAt: number | null
  erased: boolean
}

export interface AccountEntry {
  key: string
  /** The name the user gave the account (`AccountRecord.name`); the folder key stays its identity. */
  name: string | null
  global: boolean
  /** The agent whose account folder it is (`src/agent/adapters.ts`). */
  agent: string
  status: AccountStatus | null
  error: Notice | null
  loginExpiresAt: string | null
  needsLogin: boolean
  sessions: string[]
  /** The projects whose sessions run on it by their provider's pool entry, their own or the shared one (`projectsByAccount`). */
  projects: string[]
  removing: boolean
  configPending: boolean
  apiKey: boolean
  /** How its new Claude sessions run (`transportOf`); absent for an agent with one way only. */
  transport?: Transport
  limits: RateLimits | null
  usage: UsageHealth
  /** When an account whose limit nothing tells last hit it, by the chain's sessions since the start (BTN-342). */
  lastLimitAt?: string | null
}

export interface AccountLogin {
  /** The agent signing in: a new account's too, which has no `target` yet. */
  agent: string
  /** The way of `SIGN_INS` it signs in by, so "Try again" starts the same one; absent for an agent with one way. */
  method?: string
  target: string | null
  startedAt: string
  urls: string[]
  /** The one-time code a device sign-in printed (`loginCode`), for the user to enter on the sign-in page. */
  deviceCode: string | null
  output: string
  error: Notice | null
  codeSent: boolean
}

export interface AccountView {
  /** The account holding the Even Keel role: the shared provider's entry of the shared pool, Claude's or Codex's. */
  active: string
  accounts: AccountEntry[]
  login: AccountLogin | null
  loginBlock: LoginBlock | null
  apps: AppAccount[]
  /** Every pool entry of the config: the account folders it names cannot be removed. */
  pool: PoolEntry[]
  /** The agents whose CLI is not found (`Agent.installed`): no account of theirs is added from the page. */
  missing: string[]
}

/** A pool entry naming an account folder for a provider: the shared pool's (`project` null) or a project's own. */
export interface PoolEntry {
  project: string | null
  provider: string
  account: string
}

export interface LoginBlocker {
  name: string
  status: 'busy' | 'waiting'
  waitingFor: string | null
}

export interface LoginBlock {
  chains: string[]
  sessions: LoginBlocker[]
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g
const URL_PATTERN = /https:\/\/[^\s"'<>\u001b]+/g
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/
/** Codex's code is the line under "Enter this one-time code", OpenCode's follows "Enter code:"; a code counts once its line ends. */
const DEVICE_CODE = /(?:one-time code[^\n]*\n[ \t]*|Enter code:[ \t]*)([A-Z0-9]+(?:-[A-Z0-9]+)*)[ \t]*\n/g

export function parseAuthStatus(text: string): AccountStatus {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw fail('claude.statusNotJson', {}, { detail: text.trim().slice(0, 200) })
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw fail('claude.statusNotObject', {})
  const fields = body as Record<string, unknown>
  if (typeof fields.loggedIn !== 'boolean') throw fail('claude.statusNoFlag', {})
  return {
    loggedIn: fields.loggedIn,
    authMethod: stringOf(fields.authMethod),
    email: stringOf(fields.email),
    orgName: stringOf(fields.orgName),
    subscriptionType: stringOf(fields.subscriptionType),
  }
}

/** An API account signs in with a key from its folder's `settings.json`, not with claude.ai (`docs/accounts.md`). */
export function isApiKey(status: AccountStatus | null): boolean {
  return status?.authMethod === 'api_key' || status?.authMethod === 'api_key_helper'
}

/** An API account has no e-mail: its folder key stands in for it wherever an account is told apart by e-mail. */
export function withIdentity(status: AccountStatus, key: string): AccountStatus {
  return status.loggedIn && status.email === null && isApiKey(status) ? { ...status, email: key } : status
}

export function cleanOutput(raw: string): string {
  return raw.replace(ANSI, '').replace(/\r\n?/g, '\n')
}

export function loginUrls(output: string): string[] {
  const found = cleanOutput(output).match(URL_PATTERN) ?? []
  return [...new Set(found.map((url) => url.replace(TRAILING_PUNCTUATION, '')))]
}

/** The one-time code a device sign-in printed, Codex's or OpenCode's: the last one, `null` when there is none yet. */
export function loginCode(output: string): string | null {
  return [...cleanOutput(output).matchAll(DEVICE_CODE)].at(-1)?.[1] ?? null
}

export function parseCredentialTimes(text: string | undefined): CredentialTimes {
  const none = { accessExpiresAt: null, loginExpiresAt: null, erased: false }
  if (text === undefined) return none
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return none
  }
  const oauth = (body as { claudeAiOauth?: unknown } | null)?.claudeAiOauth
  if (typeof oauth !== 'object' || oauth === null) return none
  const { expiresAt, refreshTokenExpiresAt } = oauth as Record<string, unknown>
  const time = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  return { accessExpiresAt: time(expiresAt), loginExpiresAt: time(refreshTokenExpiresAt), erased: expiresAt === 0 }
}

export function needsLogin(status: AccountStatus | null, times: CredentialTimes, now: Date): boolean {
  if (status?.loggedIn === false || times.erased) return true
  return times.loginExpiresAt !== null && times.loginExpiresAt <= now.getTime()
}

export function folderName(email: string | null, taken: string[]): string {
  const local = (email ?? '').split('@')[0]!.toLowerCase()
  const base = local.replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '') || 'account'
  const used = new Set([...taken.map((name) => name.toLowerCase()), GLOBAL_ACCOUNT, CODEX_ACCOUNT])
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base}-${index}`)) index++
  return `${base}-${index}`
}

export function accountId(key: string, email: string | null): string | null {
  return email === null ? null : `${key}/${email}`
}

export function activeEntry(view: AccountView): AccountEntry | undefined {
  return view.accounts.find((entry) => entry.key === view.active)
}

export function switchProblem(view: AccountView, key: string): Notice | undefined {
  const target = view.accounts.find((entry) => entry.key === key)
  if (target === undefined) return notice('account.unknown', { key })
  if (key === view.active) return notice('account.alreadyActive', { key })
  if (target.removing) return notice('account.removing', { account: target.status?.email ?? key })
  if (target.needsLogin || target.status?.loggedIn !== true) return notice('account.needsLogin', { account: target.status?.email ?? key })
  return freeHeld(view.accounts, key)
}

export function removeProblem(view: AccountView, key: string): Notice | undefined {
  const target = view.accounts.find((entry) => entry.key === key)
  if (target === undefined) return notice('account.unknown', { key })
  if (target.global) return notice(target.agent === CLAUDE ? 'account.globalKept' : 'account.codexHomeKept', {})
  if (key === view.active) return notice('account.activeKept', {})
  const named = view.pool.filter((entry) => entry.account === key)
  if (named.some((entry) => entry.project === null)) return notice('account.sharedPool', {})
  if (named.length > 0) return notice('account.projectPool', { projects: [...new Set(named.map((entry) => entry.project!))] })
  if (view.login?.target === key && view.login.error === null) return notice('account.signInRunning', {})
  const user = view.apps.find((app) => app.account === key)
  if (user !== undefined) return notice('account.usedByApp', { app: APP_LABELS[user.app] })
  return undefined
}

export function liveSessions(agents: AgentEntry[], key: string): string[] {
  return agents
    .filter((agent) => (agent.account ?? GLOBAL_ACCOUNT) === key && isLive(agent))
    .map((agent) => agent.name ?? agent.sessionId.slice(0, 8))
}

export function loginBlock(chains: ActiveChain[], agents: AgentEntry[], active: string): LoginBlock | null {
  const running = chains.filter((chain) => !chain.paused).map((chain) => chain.project)
  const busy = agents.flatMap((agent): LoginBlocker[] => {
    if ((agent.account ?? GLOBAL_ACCOUNT) !== active) return []
    if (agent.state === 'done' || agent.state === 'stopped' || agent.state === 'failed') return []
    if (agent.status !== 'busy' && agent.status !== 'shell' && agent.status !== 'waiting') return []
    const status = agent.status === 'waiting' ? 'waiting' : 'busy'
    return [{ name: agent.name ?? agent.sessionId.slice(0, 8), status, waitingFor: agent.waitingFor ?? null }]
  })
  return running.length === 0 && busy.length === 0 ? null : { chains: running, sessions: busy }
}

export function loginBlockNotice(block: LoginBlock): Notice {
  if (block.chains.length > 0) return notice('account.chainRunning', { project: block.chains.join(', ') })
  return notice('account.sessionsBusy', { sessions: block.sessions.map((session) => session.name) })
}

/** Why no session starts in the account folder `key` — the active one, where Claude sessions start, unless given. */
export function launchBlock(view: AccountView, key = view.active): Notice | undefined {
  const active = view.accounts.find((entry) => entry.key === key)
  if (active === undefined) return key === view.active ? notice('account.activeGone', { key }) : notice('account.homeGone', { key })
  if (view.login !== null && view.login.target === key && view.login.error === null) return notice('account.signingIn', {})
  if (active.status?.loggedIn === false) return notice('account.signedOut', {})
  if (active.needsLogin) return notice('account.loginExpired', { account: active.status?.email ?? active.key })
  return freeHeld(view.accounts, key)
}

/**
 * The keys of the Codex accounts on the free plan past the first in the folders' order: OpenAI's terms forbid several
 * free accounts to get round the limits, so only the first of them works (BTN-176).
 */
export function extraFree(accounts: AccountEntry[]): string[] {
  return freeCodex(accounts)
    .slice(1)
    .map((entry) => entry.key)
}

/**
 * Whether an account of the agent just added takes the shared pool's entry for it: it does while that entry names no
 * folder of the agent, so an install that signed in only from the page does not stay on a built-in folder that was
 * never there (BTN-227).
 */
export function takesShared(pool: PoolEntry[], homes: { key: string; agent: string }[], agent: string): boolean {
  const shared = pool.find((entry) => entry.project === null && entry.provider === agent)?.account
  return shared === undefined || !homes.some((home) => home.key === shared && home.agent === agent)
}

/** Why no account of the agent is added: its CLI is not found, with where to get it. */
export function missingNotice(agent: string): Notice {
  if (agent === OPENCODE) return notice('login.opencodeMissing', {})
  if (agent === COPILOT) return notice('login.copilotMissing', {})
  return notice(agent === CODEX ? 'login.codexMissing' : 'login.claudeMissing', {})
}

/**
 * Why a Codex sign-in on the free plan is not added: another account already holds the one free plan, or the sign-in
 * is that very account again.
 */
export function secondFreeProblem(accounts: AccountEntry[], agent: string, status: AccountStatus): Notice | undefined {
  if (agent !== CODEX || !isFree(status)) return undefined
  const first = freeCodex(accounts)[0]
  if (first === undefined) return undefined
  const account = first.status?.email ?? first.key
  const same = status.email !== null && first.status?.email?.toLowerCase() === status.email.toLowerCase()
  return notice(same ? 'account.sameFree' : 'account.secondFree', { account })
}

function freeHeld(accounts: AccountEntry[], key: string): Notice | undefined {
  const [first, ...rest] = freeCodex(accounts)
  if (first === undefined || !rest.some((entry) => entry.key === key)) return undefined
  return notice('account.extraFree', { account: first.status?.email ?? first.key })
}

function freeCodex(accounts: AccountEntry[]): AccountEntry[] {
  return accounts.filter((entry) => entry.agent === CODEX && isFree(entry.status))
}

function isFree(status: AccountStatus | null): boolean {
  return status?.loggedIn === true && status.subscriptionType === FREE_PLAN
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}
