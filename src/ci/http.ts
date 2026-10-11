import { fail } from '../notice/notice.js'

export async function getJson<T>(ci: string, url: string, authorization: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<T> {
  return (await (await get(ci, url, authorization, 'application/json', timeoutMs, fetchImpl)).json()) as T
}

/** Redirects are followed: GitHub answers a job log with one to a signed address. */
export async function getText(ci: string, url: string, authorization: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<string> {
  return (await get(ci, url, authorization, 'text/plain', timeoutMs, fetchImpl)).text()
}

async function get(ci: string, url: string, authorization: string, accept: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<Response> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: { authorization, accept, 'user-agent': 'even-keel' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw fail('ci.unreachable', { ci }, { detail: error instanceof Error ? error.message : String(error) }, { cause: error })
  }
  if (response.status === 401 || response.status === 403) throw fail('ci.denied', { ci, status: response.status })
  if (!response.ok) throw fail('ci.http', { ci, status: response.status })
  return response
}
