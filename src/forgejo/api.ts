import { forgejoBase } from '../ci/host.js'
import { trackedFetch } from '../tracker/diagnostics.js'
import { CredentialsRefused, TrackerNotFound } from '../tracker/source.js'

export class ForgejoHttpError extends Error {
  constructor(readonly status: number) {
    super(`forgejo: HTTP ${status}`)
  }
}

/**
 * The Gitea API Forgejo keeps (`/api/v1`), with the profile's token. A page holds at most the server's
 * `MAX_RESPONSE_ITEMS` (50 by default) whatever `limit` asks, so `collect` goes by `x-total-count`.
 */
export class ForgejoApi {
  readonly base: string

  constructor(web: string, private readonly token: string, private readonly timeoutMs: number, private readonly fetchImpl: typeof fetch = fetch) {
    this.base = `${forgejoBase(web)}/api/v1`
  }

  async request(path: string, method = 'GET', body?: unknown): Promise<Response> {
    const response = await trackedFetch(this.fetchImpl, `${this.base}${path}`, {
      method,
      headers: { authorization: `token ${this.token}`, accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'even-keel' },
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: 'error',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, path.replace(/\?.*$/, ''))
    if (response.ok) return response
    await response.body?.cancel()
    if (response.status === 401) throw new CredentialsRefused('forgejo: the token is refused (HTTP 401)')
    if (response.status === 404) throw new TrackerNotFound('forgejo: not found or the token cannot see it (HTTP 404)')
    throw new ForgejoHttpError(response.status)
  }

  async rest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await this.request(path, method, body)
    // A 204 (an empty answer: a collaborator check, a deleted label) has no JSON.
    return (response.status === 204 ? undefined : await response.json()) as T
  }

  async collect<T>(path: string, limit = 50): Promise<T[]> {
    const result: T[] = []
    for (let page = 1; ; page++) {
      const response = await this.request(`${path}${path.includes('?') ? '&' : '?'}limit=${limit}&page=${page}`)
      const rows = ((await response.json()) as T[] | null) ?? []
      result.push(...rows)
      const total = Number.parseInt(response.headers.get('x-total-count') ?? '', 10)
      if (rows.length === 0 || (Number.isNaN(total) ? rows.length < limit : result.length >= total)) return result
    }
  }
}
