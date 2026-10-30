import { notice } from '../notice/notice.js'
import type { LimitWindow, RateLimits } from './model.js'
import type { UsageAnswer } from './usage.js'
import { chatGptCredits } from './overage.js'

/** What Codex's `/status` asks: the windows of the ChatGPT subscription, shared by every client signed in to it. */
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const AUTH_CLAIM = 'https://api.openai.com/auth'
const FIVE_HOURS = 300
const WEEK = 10080
const MONTH = 43200
const POLL_MS = 5 * 60_000
const polls = new Map<string, { until: number; token: string; refused: boolean; answer: Promise<UsageAnswer> }>()

/** A ChatGPT sign-in as a client keeps it: the access token, the account it is for, when it expires (ms). */
export interface ChatGptSignIn {
  token: string
  accountId: string | null
  expiresAt: number | null
}

/**
 * The windows of ChatGPT's usage answer (BTN-341): `rate_limit.primary_window`/`secondary_window`, each with the share
 * used, its length and its reset in seconds — the five-hour, the weekly and the free plan's 30-day window by their length,
 * as Codex's rollouts (`limitsOfRollout`). `undefined` — the answer holds no window.
 */
export function chatGptLimits(body: unknown, at: string): RateLimits | undefined {
  const limit = isRecord(body) ? body.rate_limit : undefined
  const overage = chatGptCredits(isRecord(body) ? body.credits : undefined, at)
  const windows = isRecord(limit) ? [limit.primary_window, limit.secondary_window].filter(isRecord) : []
  if (windows.length === 0 && overage === undefined) return undefined
  const of = (minutes: number) => {
    const found = windows.find((window) => window.limit_window_seconds === minutes * 60)
    return found === undefined ? null : windowOf(found, at)
  }
  const monthly = windows.some((window) => window.limit_window_seconds === MONTH * 60)
  const flags = isRecord(limit) && (typeof limit.allowed === 'boolean' || typeof limit.limit_reached === 'boolean') ? limit : undefined
  const open = flags === undefined ? undefined : flags.allowed === true && flags.limit_reached === false
  return {
    fiveHour: of(FIVE_HOURS),
    sevenDay: of(WEEK),
    ...(monthly ? { month: of(MONTH) } : {}),
    updatedAt: at,
    source: 'api',
    ...(overage !== undefined && { overage }),
    ...(open !== undefined && { open }),
  }
}

/** The ChatGPT account an access token is for, by its claim; `null` — not a token that says. */
export function chatGptAccountOf(token: string): string | null {
  const auth = claimsOf(token)?.[AUTH_CLAIM]
  const id = isRecord(auth) ? auth.chatgpt_account_id : undefined
  return typeof id === 'string' && id !== '' ? id : null
}

/** The ChatGPT account a Codex folder's `auth.json` is signed in to; `null` — an API key or no sign-in. */
export function chatGptAccountIn(codexAuth: string | undefined): string | null {
  try {
    const value: unknown = JSON.parse(codexAuth ?? '')
    const tokens = isRecord(value) ? value.tokens : undefined
    if (!isRecord(tokens)) return null
    const { account_id: id, access_token: access } = tokens
    if (typeof id === 'string' && id !== '') return id
    return typeof access === 'string' ? chatGptAccountOf(access) : null
  } catch {
    return null
  }
}

/** The ChatGPT access token in Codex's `auth.json`; API keys and incomplete sign-ins have none. */
export function chatGptSignInIn(codexAuth: string | undefined): ChatGptSignIn | undefined {
  try {
    const value: unknown = JSON.parse(codexAuth ?? '')
    if (!isRecord(value) || value.auth_mode === 'apikey') return undefined
    const tokens = value.tokens
    if (!isRecord(tokens) || typeof tokens.access_token !== 'string' || tokens.access_token === '') return undefined
    const exp = claimsOf(tokens.access_token)?.exp
    const expiresAt = typeof exp === 'number' && Number.isFinite(exp) && exp > 0 ? exp * 1000 : null
    return { token: tokens.access_token, accountId: chatGptAccountIn(codexAuth), expiresAt }
  } catch {
    return undefined
  }
}

/** Shares a five-minute poll, including an in-flight call, across Codex and OpenCode folders on one ChatGPT account. */
export async function pollChatGpt(signIn: ChatGptSignIn, at: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<UsageAnswer> {
  const now = Date.parse(at)
  for (const [key, poll] of polls) if (poll.until <= now) polls.delete(key)
  const account = signIn.accountId ?? chatGptAccountOf(signIn.token)
  const key = account === null ? `token:${signIn.token}` : chatGptPool(account)
  const held = polls.get(key)
  if (held !== undefined) {
    const answer = await held.answer
    if (!held.refused || held.token === signIn.token) return answer
    if (polls.get(key) !== held) return pollChatGpt(signIn, at, timeoutMs, fetchImpl)
  }
  const poll = { until: now + POLL_MS, token: signIn.token, refused: false, answer: askChatGpt(signIn, at, timeoutMs, fetchImpl) }
  polls.set(key, poll)
  const answer = await poll.answer
  // A refused token belongs to one folder; another client's valid sign-in may still read the same pool.
  poll.refused = answer.kind === 'missing'
  return answer
}

/**
 * Asks ChatGPT for the subscription's windows without renewing the sign-in. Expiry and refusal have separate reasons;
 * the owning client decides whether to renew. Any other failure throws, for the watcher to retry.
 */
export async function askChatGpt(signIn: ChatGptSignIn, at: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<UsageAnswer> {
  if (signIn.expiresAt !== null && signIn.expiresAt <= Date.parse(at)) return { kind: 'missing', reason: notice('usage.chatGptExpired', {}) }
  const accountId = signIn.accountId ?? chatGptAccountOf(signIn.token)
  const headers: Record<string, string> = { Authorization: `Bearer ${signIn.token}`, Accept: 'application/json' }
  if (accountId !== null) headers['ChatGPT-Account-Id'] = accountId
  const response = await fetchImpl(CHATGPT_USAGE_URL, { headers, signal: AbortSignal.timeout(timeoutMs) })
  if (response.status === 401 || response.status === 403) return { kind: 'missing', reason: notice('usage.chatGptRevoked', {}) }
  if (!response.ok) throw new Error(`ChatGPT usage answered ${response.status}`)
  const limits = chatGptLimits(await response.json().catch(() => undefined), at)
  if (limits === undefined) return { kind: 'unknown', reason: notice('usage.chatGptUnread', {}) }
  return { kind: 'limits', limits: accountId === null ? limits : { ...limits, pool: chatGptPool(accountId) } }
}

/** The pool of a ChatGPT account: a Codex and an OpenCode folder signed in to it share its limits. */
export function chatGptPool(accountId: string): string {
  return `chatgpt:${accountId}`
}

function windowOf(raw: Record<string, unknown>, at: string): LimitWindow | null {
  const { used_percent: used, reset_at: resetAt, reset_after_seconds: after } = raw
  if (typeof used !== 'number' || !Number.isFinite(used)) return null
  const reset = typeof resetAt === 'number' && resetAt > 0 ? resetAt * 1000 : typeof after === 'number' ? Date.parse(at) + after * 1000 : NaN
  return Number.isFinite(reset) ? { usedPercentage: used, resetsAt: new Date(reset).toISOString() } : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function claimsOf(token: string): Record<string, unknown> | undefined {
  try {
    const claims: unknown = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))
    return isRecord(claims) ? claims : undefined
  } catch {
    return undefined
  }
}
