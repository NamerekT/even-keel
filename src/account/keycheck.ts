const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1'
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models'
const GITHUB_USER_URL = 'https://api.github.com/user'
const API_VERSION = '2023-06-01'

export type KeyVerdict = { state: 'ok' } | { state: 'rejected' } | { state: 'unknown'; reason: string }

/** Asks Anthropic whether it takes the key: the models list costs no tokens. 401 and 403 are a refused key. */
export function checkApiKey(key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<KeyVerdict> {
  return askModels(MODELS_URL, { 'x-api-key': key, 'anthropic-version': API_VERSION }, timeoutMs, fetchImpl)
}

/** The same question to OpenAI for a Codex key (BTN-177). */
export function checkOpenAiKey(key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<KeyVerdict> {
  return askModels(OPENAI_MODELS_URL, { authorization: `Bearer ${key}` }, timeoutMs, fetchImpl)
}

/**
 * Whether GitHub takes a Copilot account's token (BTN-215): `/user` answers any valid token for free. Whether it may make
 * Copilot requests is not asked — only a session shows that.
 */
export function checkGitHubToken(key: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<KeyVerdict> {
  return askModels(GITHUB_USER_URL, { authorization: `Bearer ${key}`, accept: 'application/vnd.github+json', 'user-agent': 'even-keel' }, timeoutMs, fetchImpl)
}

async function askModels(url: string, headers: Record<string, string>, timeoutMs: number, fetchImpl: typeof fetch): Promise<KeyVerdict> {
  let response: Response
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    return { state: 'unknown', reason: error instanceof Error ? error.message : String(error) }
  }
  await response.body?.cancel()
  if (response.ok) return { state: 'ok' }
  if (response.status === 401 || response.status === 403) return { state: 'rejected' }
  return { state: 'unknown', reason: `HTTP ${response.status}` }
}

interface Checked {
  at: number
  rejected: boolean
}

/** The last check of each API account's key: one per interval, and a check that learns nothing keeps the verdict. */
export class KeyChecks {
  private readonly checked = new Map<string, Checked>()

  constructor(private readonly intervalMs: number) {}

  due(key: string, now: Date): boolean {
    const last = this.checked.get(key)
    return last === undefined || now.getTime() - last.at >= this.intervalMs
  }

  note(key: string, verdict: KeyVerdict, now: Date): void {
    const rejected = verdict.state === 'unknown' ? (this.checked.get(key)?.rejected ?? false) : verdict.state === 'rejected'
    this.checked.set(key, { at: now.getTime(), rejected })
  }

  rejected(key: string): boolean {
    return this.checked.get(key)?.rejected ?? false
  }

  forget(key: string): void {
    this.checked.delete(key)
  }
}
