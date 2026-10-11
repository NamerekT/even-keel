import { fail } from '../notice/notice.js'

export async function getJson<T>(ci: string, url: string, authorization: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<T> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: { authorization, accept: 'application/json', 'user-agent': 'even-keel' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw fail('ci.unreachable', { ci }, { detail: error instanceof Error ? error.message : String(error) }, { cause: error })
  }
  if (response.status === 401 || response.status === 403) throw fail('ci.denied', { ci, status: response.status })
  if (!response.ok) throw fail('ci.http', { ci, status: response.status })
  return (await response.json()) as T
}
