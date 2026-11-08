const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1'
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models'
const OPENAI_ME_URL = 'https://api.openai.com/v1/me'
const GITHUB_USER_URL = 'https://api.github.com/user'
/**
 * Describes the key that asks, for free: whether it works, what it has spent (`usage`, BTN-860) and what is left of its
 * own limit (BTN-847).
 */
export const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key'
const API_VERSION = '2023-06-01'
const LIMIT_RESETS = ['daily', 'weekly', 'monthly'] as const

/**
 * The spending limit set on the key itself, in dollars (BTN-847): OpenRouter's `limit_remaining` out of `limit`, which
 * any key may read of itself. The account's balance is another thing, and only a management key may read it.
 */
export interface KeyLimit {
  remaining: number
  limit: number
  /** How often the limit starts again; null — never. */
  reset: (typeof LIMIT_RESETS)[number] | null
}

/**
 * A working key's answer may name the organization that pays for it (BTN-418): a key of another one is another account.
 * A refused key's answer names none. `limit` — the key's own spending limit, when it has one (OpenRouter only).
 */
export type KeyVerdict = { state: 'ok'; organization?: string; limit?: KeyLimit } | { state: 'rejected' } | { state: 'unknown'; reason: string }

/** The key's own limit from the `data` of `GET /api/v1/key`; null — the key has none, or the answer does not tell it. */
export function openRouterLimit(data: unknown): KeyLimit | null {
  if (typeof data !== 'object' || data === null) return null
  const { limit, limit_remaining: remaining, limit_reset: reset } = data as Record<string, unknown>
  if (typeof limit !== 'number' || !Number.isFinite(limit) || typeof remaining !== 'number' || !Number.isFinite(remaining)) return null
  return { remaining, limit, reset: LIMIT_RESETS.find((each) => each === reset) ?? null }
}

/** Asks Anthropic whether it takes the key: the models list costs no tokens. 401 and 403 are a refused key. */
export function checkApiKey(key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<KeyVerdict> {
  return askModels(MODELS_URL, { 'x-api-key': key, 'anthropic-version': API_VERSION }, timeoutMs, fetchImpl, 'anthropic-organization-id')
}

/**
 * The same question to OpenAI for a Codex key (BTN-177). OpenAI's models list carries no `openai-organization` (BTN-649),
 * so a working key's organization is asked of `/v1/me`; a failure there leaves the key working, its organization unknown.
 */
export async function checkOpenAiKey(key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<KeyVerdict> {
  const headers = { authorization: `Bearer ${key}` }
  const verdict = await askModels(OPENAI_MODELS_URL, headers, timeoutMs, fetchImpl, 'openai-organization')
  if (verdict.state !== 'ok' || verdict.organization !== undefined) return verdict
  const me = await askModels(OPENAI_ME_URL, headers, timeoutMs, fetchImpl, 'openai-organization')
  return me.state === 'ok' && me.organization !== undefined ? me : verdict
}

/**
 * Whether OpenRouter takes an OpenCode account's key (BTN-843): `/api/v1/key` describes the key for free, its own limit
 * too (BTN-847). OpenRouter has no organization header.
 */
export async function checkOpenRouterKey(key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<KeyVerdict> {
  return askModels(OPENROUTER_KEY_URL, { authorization: `Bearer ${key}` }, timeoutMs, fetchImpl, undefined, async (response) => {
    const body: unknown = await response.json()
    const limit = openRouterLimit(typeof body === 'object' && body !== null ? (body as { data?: unknown }).data : null)
    return limit === null ? {} : { limit }
  })
}

/**
 * Whether GitHub takes a Copilot account's token (BTN-215): `/user` answers any valid token for free. Whether it may make
 * Copilot requests is not asked — only a session shows that.
 */
export function checkGitHubToken(key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<KeyVerdict> {
  return askModels(GITHUB_USER_URL, { authorization: `Bearer ${key}`, accept: 'application/vnd.github+json', 'user-agent': 'even-keel' }, timeoutMs, fetchImpl)
}

async function askModels(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  organizationHeader?: string,
  /** What a working key's answer tells besides; without it the body is dropped unread, and an unreadable one tells nothing. */
  describe?: (response: Response) => Promise<{ limit?: KeyLimit }>,
): Promise<KeyVerdict> {
  let response: Response
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    return { state: 'unknown', reason: error instanceof Error ? error.message : String(error) }
  }
  const told = response.ok && describe !== undefined ? await describe(response).catch(() => ({})) : {}
  if (!(response.ok && describe !== undefined)) await response.body?.cancel()
  if (response.ok) {
    const organization = organizationHeader === undefined ? '' : (response.headers.get(organizationHeader)?.trim() ?? '')
    return organization === '' ? { state: 'ok', ...told } : { state: 'ok', organization, ...told }
  }
  if (response.status === 401 || response.status === 403) return { state: 'rejected' }
  return { state: 'unknown', reason: `HTTP ${response.status}` }
}

interface Checked {
  at: number
  rejected: boolean
}

/** A key's own limit as last read, and when (BTN-847). */
export type ReadKeyLimit = KeyLimit & { at: string }

/** The last check of each API account's key: one per interval, and a check that learns nothing keeps the verdict. */
export class KeyChecks {
  private readonly checked = new Map<string, Checked>()
  private readonly limits = new Map<string, ReadKeyLimit>()

  constructor(private readonly intervalMs: number) {}

  due(key: string, now: Date): boolean {
    const last = this.checked.get(key)
    return last === undefined || now.getTime() - last.at >= this.intervalMs
  }

  /** True when the verdict or the key's limit changed. */
  note(key: string, verdict: KeyVerdict, now: Date): boolean {
    const before = this.rejected(key)
    const rejected = verdict.state === 'unknown' ? before : verdict.state === 'rejected'
    this.checked.set(key, { at: now.getTime(), rejected })
    const limitChanged = verdict.state !== 'unknown' && this.noteLimit(key, verdict.state === 'ok' ? (verdict.limit ?? null) : null, now)
    return rejected !== before || limitChanged
  }

  /**
   * A key's limit read between two checks, by a read of its spend (`readOpenRouterKey`); null — the key has none. The
   * next check stays where it was. True when the limit changed.
   */
  noteLimit(key: string, limit: KeyLimit | null, now: Date): boolean {
    const before = this.limits.get(key)
    const changed = limit === null ? before !== undefined :
      before === undefined || before.remaining !== limit.remaining || before.limit !== limit.limit || before.reset !== limit.reset
    if (limit === null) this.limits.delete(key)
    else this.limits.set(key, { ...limit, at: now.toISOString() })
    return changed
  }

  rejected(key: string): boolean {
    return this.checked.get(key)?.rejected ?? false
  }

  limit(key: string): ReadKeyLimit | null {
    return this.limits.get(key) ?? null
  }

  forget(key: string): void {
    this.checked.delete(key)
    this.limits.delete(key)
  }
}
