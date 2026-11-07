import { isSpendingLimit, spendingReset } from '../limits/spending.js'

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
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

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
      pick: (models) => {
        const ids = models.map((model) => model.id)
        return ids.find((id) => id.includes('haiku')) ?? ids[0] ?? null
      },
      body: (model) => ({ model, max_tokens: 1, messages: [{ role: 'user', content: '.' }] }),
      empty: (status, text) => status === 400 && (text.toLowerCase().includes(OUT_OF_CREDIT) || isSpendingLimit(text)),
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
      pick: (models) => {
        const text = models.map((model) => model.id).filter((id) => id.startsWith('gpt-') && !NOT_TEXT.test(id))
        return text.find((id) => id.includes('nano')) ?? text.find((id) => id.includes('mini')) ?? null
      },
      body: (model) => ({ model, input: '.', max_output_tokens: 16, store: false }),
      empty: (status, text) => status === 429 && text.includes(OPENAI_OUT_OF_MONEY),
    },
    timeoutMs,
    fetchImpl,
  )
}

/**
 * The same question to OpenRouter for an OpenCode key (BTN-843): one output token from the cheapest paid text model it
 * lists — a free one answers even with no money, and `openrouter/auto` has no price (`-1`). A key out of money answers
 * 402; its balance itself only a management key may read.
 */
export function checkOpenRouterCredit(key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<CreditVerdict> {
  return askCredit(
    {
      modelsUrl: OPENROUTER_MODELS_URL,
      url: OPENROUTER_CHAT_URL,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      pick: cheapestPaidText,
      body: (model) => ({ model, max_tokens: 1, messages: [{ role: 'user', content: '.' }] }),
      empty: (status) => status === 402,
    },
    timeoutMs,
    fetchImpl,
  )
}

function cheapestPaidText(models: ListedModel[]): string | null {
  let best: { id: string; price: number } | null = null
  for (const model of models) {
    const architecture = record(model.architecture)
    if (!listHas(architecture.input_modalities, 'text') || !listHas(architecture.output_modalities, 'text')) continue
    const pricing = record(model.pricing)
    const prices = [pricing.prompt, pricing.completion, pricing.request ?? '0'].map(Number)
    if (prices.some((price) => !Number.isFinite(price) || price < 0)) continue
    const price = prices.reduce((sum, each) => sum + each, 0)
    if (price > 0 && (best === null || price < best.price)) best = { id: model.id, price }
  }
  return best?.id ?? null
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function listHas(value: unknown, item: string): boolean {
  return Array.isArray(value) && value.includes(item)
}

/** An entry of a models list: its id and whatever else the provider tells of it. */
type ListedModel = Record<string, unknown> & { id: string }

interface CreditAsk {
  modelsUrl: string
  url: string
  headers: Record<string, string>
  pick: (models: ListedModel[]) => string | null
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
    const model = ask.pick(listedModels(await listed.json()))
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

function listedModels(body: unknown): ListedModel[] {
  const data = record(body).data
  return Array.isArray(data) ? data.map(record).filter((model): model is ListedModel => typeof model.id === 'string') : []
}

interface Wanted {
  /** The stop on credit the chain waits out (`apiError.at`). */
  since: string
  askedAt: number
  checkedAt: number
  restoredAt: string | null
  spending: { resetsAt: string | null } | null
}

/**
 * The credit of the API accounts whose session of a current task stopped on it: checked once per interval while the
 * chain keeps asking, and not past two intervals after it stopped asking.
 */
export class CreditChecks {
  private readonly wanted = new Map<string, Wanted>()

  constructor(private readonly intervalMs: number) {}

  /** When the credit of the key came back after the stop at `since`; null — not yet, and the key gets checked. */
  restoredAfter(key: string, since: string, now: Date, text = ''): string | null {
    const known = this.wanted.get(key)
    if (known === undefined || Date.parse(known.since) < Date.parse(since)) {
      const spending = isSpendingLimit(text) ? { resetsAt: spendingReset(text, since) } : null
      this.wanted.set(key, { since, askedAt: now.getTime(), checkedAt: now.getTime(), restoredAt: null, spending })
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

  spendingLimit(key: string, now: Date): { resetsAt: string | null } | null {
    const want = this.wanted.get(key)
    return want === undefined || want.restoredAt !== null || now.getTime() - want.askedAt > 2 * this.intervalMs ? null : want.spending
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
