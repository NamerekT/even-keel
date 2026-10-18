const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=100'
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'
// The API's answer to a key whose organization has no credit left; the CLI writes it down as `billing_error`.
const OUT_OF_CREDIT = 'credit balance is too low'
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models'
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const OPENAI_OUT_OF_MONEY = 'insufficient_quota'
// Models of the list that take no text input through `/v1/responses`.
const NOT_TEXT = /tts|transcribe|audio|realtime|search|image|embedding/

export type CreditVerdict = { state: 'ok' } | { state: 'empty' } | { state: 'unknown'; reason: string }

/**
 * Asks Anthropic whether the key can pay again: one output token from the cheapest model the key lists (a Haiku, else
 * the newest one) — a fraction of a cent. The models list alone costs nothing but answers even with no credit.
 */
export function checkCredit(key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<CreditVerdict> {
  return askCredit(
    {
      modelsUrl: MODELS_URL,
      url: MESSAGES_URL,
      headers: { 'x-api-key': key, 'anthropic-version': API_VERSION, 'content-type': 'application/json' },
      pick: (ids) => ids.find((id) => id.includes('haiku')) ?? ids[0] ?? null,
      body: (model) => ({ model, max_tokens: 1, messages: [{ role: 'user', content: '.' }] }),
      empty: (status, text) => status === 400 && text.toLowerCase().includes(OUT_OF_CREDIT),
    },
    timeoutMs,
    fetchImpl,
  )
}

/**
 * The same question to OpenAI for a Codex key (BTN-195): a nano text model the key lists, else a mini one, through
 * `/v1/responses` with its least `max_output_tokens`. A key out of money answers 429 `insufficient_quota`; a 429 of a
 * rate limit tells nothing.
 */
export function checkOpenAiCredit(key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<CreditVerdict> {
  return askCredit(
    {
      modelsUrl: OPENAI_MODELS_URL,
      url: OPENAI_RESPONSES_URL,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      pick: (ids) => {
        const text = ids.filter((id) => id.startsWith('gpt-') && !NOT_TEXT.test(id))
        return text.find((id) => id.includes('nano')) ?? text.find((id) => id.includes('mini')) ?? null
      },
      body: (model) => ({ model, input: '.', max_output_tokens: 16, store: false }),
      empty: (status, text) => status === 429 && text.includes(OPENAI_OUT_OF_MONEY),
    },
    timeoutMs,
    fetchImpl,
  )
}

interface CreditAsk {
  modelsUrl: string
  url: string
  headers: Record<string, string>
  pick: (ids: string[]) => string | null
  body: (model: string) => unknown
  empty: (status: number, text: string) => boolean
}

async function askCredit(ask: CreditAsk, timeoutMs: number, fetchImpl: typeof fetch): Promise<CreditVerdict> {
  try {
    const listed = await fetchImpl(ask.modelsUrl, { headers: ask.headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!listed.ok) {
      await listed.body?.cancel()
      return { state: 'unknown', reason: `models HTTP ${listed.status}` }
    }
    const model = ask.pick(modelIds(await listed.json()))
    if (model === null) return { state: 'unknown', reason: 'the key lists no models' }
    const response = await fetchImpl(ask.url, {
      method: 'POST',
      headers: ask.headers,
      body: JSON.stringify(ask.body(model)),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    if (response.ok) return { state: 'ok' }
    if (ask.empty(response.status, text)) return { state: 'empty' }
    return { state: 'unknown', reason: `HTTP ${response.status}` }
  } catch (error) {
    return { state: 'unknown', reason: error instanceof Error ? error.message : String(error) }
  }
}

function modelIds(body: unknown): string[] {
  const data = (body as { data?: unknown } | null)?.data
  return Array.isArray(data) ? data.map((model) => (model as { id?: unknown })?.id).filter((id) => typeof id === 'string') : []
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
