import type { ActiveChain } from '../chain/dispatcher.js'
import type { RateLimits } from '../limits/model.js'
import type { UsageHealth } from '../limits/usage.js'
import { fail, notice, type Notice } from '../notice/notice.js'
import type { AgentEntry } from '../sessions/agents.js'
import { APP_LABELS, type AppAccount } from './apps.js'

export const GLOBAL_ACCOUNT = 'global'

export interface ClaudeAccount {
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
  global: boolean
  status: ClaudeAccount | null
  error: Notice | null
  loginExpiresAt: string | null
  needsLogin: boolean
  sessions: string[]
  removing: boolean
  configPending: boolean
  limits: RateLimits | null
  usage: UsageHealth
}

export interface AccountLogin {
  target: string | null
  startedAt: string
  urls: string[]
  output: string
  error: Notice | null
  codeSent: boolean
}

export interface AccountView {
  active: string
  accounts: AccountEntry[]
  login: AccountLogin | null
  loginBlock: LoginBlock | null
  apps: AppAccount[]
}

export interface LoginBlocker {
  name: string
  status: 'busy' | 'waiting'
  waitingFor: string | null
}

export interface LoginBlock {
  chain: string | null
  sessions: LoginBlocker[]
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g
const URL_PATTERN = /https:\/\/[^\s"'<>\u001b]+/g
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/

export function parseAuthStatus(text: string): ClaudeAccount {
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

export function cleanOutput(raw: string): string {
  return raw.replace(ANSI, '').replace(/\r\n?/g, '\n')
}

export function loginUrls(output: string): string[] {
  const found = cleanOutput(output).match(URL_PATTERN) ?? []
  return [...new Set(found.map((url) => url.replace(TRAILING_PUNCTUATION, '')))]
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

export function needsLogin(status: ClaudeAccount | null, times: CredentialTimes, now: Date): boolean {
  if (status?.loggedIn === false || times.erased) return true
  return times.loginExpiresAt !== null && times.loginExpiresAt <= now.getTime()
}

export function folderName(email: string | null, taken: string[]): string {
  const local = (email ?? '').split('@')[0]!.toLowerCase()
  const base = local.replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '') || 'account'
  const used = new Set([...taken.map((name) => name.toLowerCase()), GLOBAL_ACCOUNT])
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
  if (view.loginBlock !== null) return loginBlockNotice(view.loginBlock)
  return undefined
}

export function removeProblem(view: AccountView, key: string): Notice | undefined {
  const target = view.accounts.find((entry) => entry.key === key)
  if (target === undefined) return notice('account.unknown', { key })
  if (target.global) return notice('account.globalKept', {})
  if (key === view.active) return notice('account.activeKept', {})
  if (view.login?.target === key && view.login.error === null) return notice('account.signInRunning', {})
  const user = view.apps.find((app) => app.account === key)
  if (user !== undefined) return notice('account.usedByApp', { app: APP_LABELS[user.app] })
  return undefined
}

export function liveSessions(agents: AgentEntry[], key: string): string[] {
  return agents
    .filter((agent) => (agent.account ?? GLOBAL_ACCOUNT) === key && agent.pid !== undefined)
    .map((agent) => agent.name ?? agent.sessionId.slice(0, 8))
}

export function loginBlock(chain: ActiveChain | null, agents: AgentEntry[], active: string): LoginBlock | null {
  const running = chain !== null && !chain.paused ? chain.project : null
  const busy = agents.flatMap((agent): LoginBlocker[] => {
    if ((agent.account ?? GLOBAL_ACCOUNT) !== active) return []
    if (agent.state === 'done' || agent.state === 'stopped' || agent.state === 'failed') return []
    if (agent.status !== 'busy' && agent.status !== 'waiting') return []
    return [{ name: agent.name ?? agent.sessionId.slice(0, 8), status: agent.status, waitingFor: agent.waitingFor ?? null }]
  })
  return running === null && busy.length === 0 ? null : { chain: running, sessions: busy }
}

export function loginBlockNotice(block: LoginBlock): Notice {
  if (block.chain !== null) return notice('account.chainRunning', { project: block.chain })
  return notice('account.sessionsBusy', { sessions: block.sessions.map((session) => session.name) })
}

export function launchBlock(view: AccountView): Notice | undefined {
  const active = activeEntry(view)
  if (active === undefined) return notice('account.activeGone', { key: view.active })
  if (view.login !== null && view.login.target === view.active && view.login.error === null) return notice('account.signingIn', {})
  if (active.status?.loggedIn === false) return notice('account.signedOut', {})
  if (active.needsLogin) return notice('account.loginExpired', { account: active.status?.email ?? active.key })
  return undefined
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}
