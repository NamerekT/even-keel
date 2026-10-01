import type { ActiveChain } from '../chain/dispatcher.js'
import type { RateLimits } from '../limits/model.js'
import type { UsageHealth } from '../limits/usage.js'
import type { AgentEntry } from '../sessions/agents.js'

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
  error: string | null
  loginExpiresAt: string | null
  needsLogin: boolean
  sessions: number
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
  error: string | null
  codeSent: boolean
}

export interface AccountView {
  active: string
  accounts: AccountEntry[]
  login: AccountLogin | null
  loginBlock: LoginBlock | null
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
    throw new Error(`claude: auth status is not JSON: ${text.trim().slice(0, 200)}`)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('claude: auth status is not an object')
  const fields = body as Record<string, unknown>
  if (typeof fields.loggedIn !== 'boolean') throw new Error('claude: auth status has no loggedIn flag')
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

export function switchProblem(view: AccountView, key: string): string | undefined {
  const target = view.accounts.find((entry) => entry.key === key)
  if (target === undefined) return `claude: there is no account ${key}`
  if (key === view.active) return `claude: ${key} is already active`
  if (target.removing) return `claude: ${target.status?.email ?? key} is being removed; keep it first`
  if (target.needsLogin || target.status?.loggedIn !== true) return `claude: ${target.status?.email ?? key} needs a login first`
  if (view.loginBlock !== null) return loginBlockMessage(view.loginBlock)
  return undefined
}

export function removeProblem(view: AccountView, key: string): string | undefined {
  const target = view.accounts.find((entry) => entry.key === key)
  if (target === undefined) return `claude: there is no account ${key}`
  if (target.global) return 'claude: the global account lives in ~/.claude and is not removed from here'
  if (key === view.active) return 'claude: the active account cannot be removed; switch to another one first'
  if (view.login?.target === key && view.login.error === null) return 'claude: a sign-in into this account is running'
  return undefined
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

export function loginBlockMessage(block: LoginBlock): string {
  if (block.chain !== null) return `claude: chain ${block.chain} is running; pause it before switching the account`
  const names = block.sessions.map((session) => session.name).join(', ')
  return `claude: sessions are in the middle of a turn (${names}); switch the account once they finish`
}

export function launchBlock(view: AccountView): string | undefined {
  const active = activeEntry(view)
  if (active === undefined) return `claude: the active account folder ${view.active} is gone; switch to another account, then resume`
  if (view.login !== null && view.login.target === view.active && view.login.error === null) {
    return 'claude: sign-in is in progress; resume once it is done'
  }
  if (active.status?.loggedIn === false) return 'claude: not signed in; sign in from the account menu, then resume'
  if (active.needsLogin) {
    return `claude: the login of ${active.status?.email ?? active.key} has run out; renew it from the account menu, then resume`
  }
  return undefined
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}
