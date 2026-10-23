import { notice } from '../notice/notice.js'
import type { LimitWindow, RateLimits } from './model.js'
import type { UsageAnswer } from './usage.js'

/** What Codex's `/status` asks: the windows of the ChatGPT subscription, shared by every client signed in to it. */
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const AUTH_CLAIM = 'https://api.openai.com/auth'
const FIVE_HOURS = 300
const WEEK = 10080
const MONTH = 43200

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
  if (!isRecord(limit)) return undefined
  const windows = [limit.primary_window, limit.secondary_window].filter(isRecord)
  if (windows.length === 0) return undefined
  const of = (minutes: number) => {
    const found = windows.find((window) => window.limit_window_seconds === minutes * 60)
    return found === undefined ? null : windowOf(found, at)
  }
  const monthly = windows.some((window) => window.limit_window_seconds === MONTH * 60)
  return { fiveHour: of(FIVE_HOURS), sevenDay: of(WEEK), ...(monthly ? { month: of(MONTH) } : {}), updatedAt: at, source: 'api' }
}

/** The ChatGPT account an access token is for, by its claim; `null` — not a token that says. */
export function chatGptAccountOf(token: string): string | null {
  try {
    const claims: unknown = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))
    const auth = isRecord(claims) ? claims[AUTH_CLAIM] : undefined
    const id = isRecord(auth) ? auth.chatgpt_account_id : undefined
    return typeof id === 'string' && id !== '' ? id : null
  } catch {
    return null
  }
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

/**
 * Asks ChatGPT for the subscription's windows with a client's sign-in, never renewing it: an expired or refused token
 * waits for the client's next session to renew it. Any other failure throws, for the watcher to retry.
 */
export async function askChatGpt(signIn: ChatGptSignIn, at: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<UsageAnswer> {
  if (signIn.expiresAt !== null && signIn.expiresAt <= Date.parse(at)) return { kind: 'missing', reason: notice('usage.chatGptExpired', {}) }
  const accountId = signIn.accountId ?? chatGptAccountOf(signIn.token)
  const headers: Record<string, string> = { Authorization: `Bearer ${signIn.token}`, Accept: 'application/json' }
  if (accountId !== null) headers['ChatGPT-Account-Id'] = accountId
  const response = await fetchImpl(CHATGPT_USAGE_URL, { headers, signal: AbortSignal.timeout(timeoutMs) })
  if (response.status === 401 || response.status === 403) return { kind: 'missing', reason: notice('usage.chatGptExpired', {}) }
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
