const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=100'
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'
// The API's answer to a key whose organization has no credit left; the CLI writes it down as `billing_error`.
const OUT_OF_CREDIT = 'credit balance is too low'

export type CreditVerdict = { state: 'ok' } | { state: 'empty' } | { state: 'unknown'; reason: string }

/**
 * Asks Anthropic whether the key can pay again: one output token from the cheapest model the key lists (a Haiku, else
 * the newest one) — a fraction of a cent. The models list alone costs nothing but answers even with no credit.
 */
export async function checkCredit(key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<CreditVerdict> {
  const headers = { 'x-api-key': key, 'anthropic-version': API_VERSION, 'content-type': 'application/json' }
  try {
    const listed = await fetchImpl(MODELS_URL, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!listed.ok) {
      await listed.body?.cancel()
      return { state: 'unknown', reason: `models HTTP ${listed.status}` }
    }
    const model = cheapestModel(await listed.json())
    if (model === null) return { state: 'unknown', reason: 'the key lists no models' }
    const response = await fetchImpl(MESSAGES_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: '.' }] }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    if (response.ok) return { state: 'ok' }
    if (response.status === 400 && text.toLowerCase().includes(OUT_OF_CREDIT)) return { state: 'empty' }
    return { state: 'unknown', reason: `HTTP ${response.status}` }
  } catch (error) {
    return { state: 'unknown', reason: error instanceof Error ? error.message : String(error) }
  }
}

function cheapestModel(body: unknown): string | null {
  const data = (body as { data?: unknown } | null)?.data
  const ids = Array.isArray(data) ? data.map((model) => (model as { id?: unknown })?.id).filter((id) => typeof id === 'string') : []
  return ids.find((id) => id.includes('haiku')) ?? ids[0] ?? null
}

interface Wanted {
  /** The stop on credit the chain waits out (`apiError.at`). */
  since: string
  askedAt: number
  checkedAt: number
  restoredAt: string | null
}

/**
 * The credit of the API accounts whose session of a current task stopped on it: checked once per interval while the
 * chain keeps asking, and not past two intervals after it stopped asking.
 */
export class CreditChecks {
  private readonly wanted = new Map<string, Wanted>()

  constructor(private readonly intervalMs: number) {}

  /** When the credit of the key came back after the stop at `since`; null — not yet, and the key gets checked. */
  restoredAfter(key: string, since: string, now: Date): string | null {
    const known = this.wanted.get(key)
    if (known === undefined || Date.parse(known.since) < Date.parse(since)) {
      this.wanted.set(key, { since, askedAt: now.getTime(), checkedAt: now.getTime(), restoredAt: null })
      return null
    }
    known.askedAt = now.getTime()
    return known.restoredAt
  }

  due(now: Date): string[] {
    const time = now.getTime()
    return [...this.wanted]
      .filter(([, want]) => want.restoredAt === null && time - want.askedAt <= 2 * this.intervalMs && time - want.checkedAt >= this.intervalMs)
      .map(([key]) => key)
  }

  note(key: string, verdict: CreditVerdict, now: Date): void {
    const want = this.wanted.get(key)
    if (want === undefined) return
    want.checkedAt = now.getTime()
    if (verdict.state === 'ok') want.restoredAt = now.toISOString()
  }

  forget(key: string): void {
    this.wanted.delete(key)
  }
}
