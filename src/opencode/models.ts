import { CODEX_CHECKED } from '../codex/version.js'
import { chatGptAccountOf } from '../limits/chatgpt.js'
import { credentials } from './home.js'

const MODELS_URL = 'https://chatgpt.com/backend-api/codex/models'

/** Visible model slugs for the subscription; undefined means the response cannot safely filter a catalogue. */
export function chatGptModels(body: unknown): string[] | undefined {
  if (!record(body) || !Array.isArray(body.models)) return undefined
  const models: string[] = []
  for (const model of body.models) {
    if (!record(model) || typeof model.slug !== 'string' || model.slug === '' || typeof model.visibility !== 'string') return undefined
    if (model.visibility === 'list') models.push(model.slug)
  }
  return models
}

/** Read-only: OpenCode owns renewal. An unavailable subscription list leaves its catalogue unchanged. */
export async function filterChatGptModels(
  models: string[], auth: string | undefined, timeoutMs: number, log: (line: string) => void,
  fetchImpl: typeof fetch = fetch, now = Date.now(),
): Promise<string[]> {
  const openai = credentials(auth).openai
  if (openai?.type !== 'oauth' || !models.some(model => model.startsWith('openai/'))) return models
  const skip = (reason: string) => {
    log(`models: OpenCode ChatGPT filter skipped: ${reason}`)
    return models
  }
  if (typeof openai.access !== 'string' || openai.access === '') return skip('access token missing')
  if (typeof openai.expires === 'number' && openai.expires > 0 && openai.expires <= now) return skip('access token expired')
  const accountId = typeof openai.accountId === 'string' && openai.accountId !== '' ? openai.accountId : chatGptAccountOf(openai.access)
  const headers: Record<string, string> = { Authorization: `Bearer ${openai.access}`, Accept: 'application/json' }
  if (accountId !== null) headers['ChatGPT-Account-Id'] = accountId
  try {
    const response = await fetchImpl(`${MODELS_URL}?client_version=${encodeURIComponent(CODEX_CHECKED)}`, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (response.status !== 200) return skip(`HTTP ${response.status}`)
    const allowed = chatGptModels(await response.json().catch(() => undefined))
    if (allowed === undefined) return skip('unreadable response')
    const visible = new Set(allowed.map(model => `openai/${model}`))
    return models.filter(model => !model.startsWith('openai/') || visible.has(model))
  } catch {
    return skip('request failed')
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
