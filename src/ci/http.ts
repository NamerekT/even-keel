import { fail } from '../notice/notice.js'

/** What a refused token is told it needs: the CI's runs, pull requests, issues (BTN-262). */
export type Denied = 'ci.denied' | 'review.denied' | 'intake.denied'

export async function getJson<T>(ci: string, url: string, authorization: string, timeoutMs: number, fetchImpl: typeof fetch, denied: Denied = 'ci.denied'): Promise<T> {
  return (await (await request(ci, url, { authorization, accept: 'application/json', denied }, timeoutMs, fetchImpl)).json()) as T
}

/** Redirects are followed: GitHub answers a job log with one to a signed address. */
export async function getText(ci: string, url: string, authorization: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<string> {
  return (await request(ci, url, { authorization, accept: 'text/plain' }, timeoutMs, fetchImpl)).text()
}

/** A write: opening a pull request (BTN-205). A refused token is `review.denied` — it needs to write pull requests, not only to read. */
export async function sendJson<T>(
  ci: string,
  url: string,
  authorization: string,
  body: unknown,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  method: 'POST' | 'PATCH' = 'POST',
  denied: Denied = 'review.denied',
): Promise<T> {
  const options = { authorization, accept: 'application/json', method, body: JSON.stringify(body), denied }
  return (await (await request(ci, url, options, timeoutMs, fetchImpl)).json()) as T
}

interface RequestOptions {
  authorization: string
  accept: string
  method?: string
  body?: string
  denied?: Denied
}

async function request(ci: string, url: string, options: RequestOptions, timeoutMs: number, fetchImpl: typeof fetch): Promise<Response> {
  const { authorization, accept, method = 'GET', body, denied = 'ci.denied' } = options
  let response: Response
  try {
    response = await fetchImpl(url, {
      method,
      headers: { authorization, accept, 'user-agent': 'even-keel', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw fail('ci.unreachable', { ci }, { detail: error instanceof Error ? error.message : String(error) }, { cause: error })
  }
  if (response.status === 401 || response.status === 403) throw fail(denied, { ci, status: response.status })
  if (!response.ok) throw fail('ci.http', { ci, status: response.status }, await detailOf(response, method))
  return response
}

/**
 * A refused write says why in its body (GitHub's 422 "Validation Failed" with "No commits between main and …" in its
 * `errors`); a read's body is not shown. A JSON answer is told by its messages, anything else as it is.
 */
async function detailOf(response: Response, method: string): Promise<{ detail?: string }> {
  if (method === 'GET') return {}
  try {
    const text = (await response.text()).trim()
    const told = messagesOf(text) ?? text
    return told === '' ? {} : { detail: told.slice(0, 500) }
  } catch {
    return {}
  }
}

interface ForgeRefusal {
  message?: unknown
  errors?: { message?: unknown }[]
}

function messagesOf(text: string): string | null {
  let answer: ForgeRefusal
  try {
    answer = JSON.parse(text) as ForgeRefusal
  } catch {
    return null
  }
  if (typeof answer !== 'object' || answer === null) return null
  const errors = Array.isArray(answer.errors) ? answer.errors.map((error) => error?.message) : []
  const messages = [answer.message, ...errors].filter((message): message is string => typeof message === 'string' && message.trim() !== '')
  return messages.length === 0 ? null : messages.map((message) => message.trim()).join(': ')
}
