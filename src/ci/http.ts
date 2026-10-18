import { fail } from '../notice/notice.js'

export async function getJson<T>(ci: string, url: string, authorization: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<T> {
  return (await (await request(ci, url, { authorization, accept: 'application/json' }, timeoutMs, fetchImpl)).json()) as T
}

/** Redirects are followed: GitHub answers a job log with one to a signed address. */
export async function getText(ci: string, url: string, authorization: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<string> {
  return (await request(ci, url, { authorization, accept: 'text/plain' }, timeoutMs, fetchImpl)).text()
}

/** A write: opening a pull request (BTN-205). A refused token is `review.denied` — it needs to write pull requests, not only to read. */
export async function sendJson<T>(ci: string, url: string, authorization: string, body: unknown, timeoutMs: number, fetchImpl: typeof fetch): Promise<T> {
  const options = { authorization, accept: 'application/json', method: 'POST', body: JSON.stringify(body), denied: 'review.denied' as const }
  return (await (await request(ci, url, options, timeoutMs, fetchImpl)).json()) as T
}

interface RequestOptions {
  authorization: string
  accept: string
  method?: string
  body?: string
  denied?: 'ci.denied' | 'review.denied'
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

/** A refused write says why in its body (GitHub's 422 "A pull request already exists"); a read's body is not shown. */
async function detailOf(response: Response, method: string): Promise<{ detail?: string }> {
  if (method === 'GET') return {}
  try {
    const text = (await response.text()).trim()
    return text === '' ? {} : { detail: text.slice(0, 500) }
  } catch {
    return {}
  }
}
