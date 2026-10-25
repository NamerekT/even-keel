import { fail } from '../notice/notice.js'
import { CredentialsRefused, TrackerNotFound } from '../tracker/source.js'

export const GITLAB_URL = 'GITLAB_URL'
export const GITLAB_TOKEN = 'GITLAB_TOKEN'

export function webUrl(values: Readonly<Record<string, string | undefined>>): string {
  const value = (values[GITLAB_URL] || 'https://gitlab.com').trim().replace(/\/+$/, '')
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname.endsWith('/api/v4')) throw new Error()
    return value
  } catch {
    throw fail('gitlab.url', {})
  }
}

export class GitlabHttpError extends Error {
  constructor(readonly status: number) {
    super(`gitlab: HTTP ${status}`)
  }
}

export class GitlabApi {
  constructor(readonly web: string, private readonly token: string, private readonly timeoutMs: number, private readonly fetchImpl: typeof fetch = fetch) {}

  async request(path: string, method = 'GET', body?: unknown): Promise<Response> {
    const response = await this.fetchImpl(`${this.web}${path}`, {
      method,
      headers: { 'private-token': this.token, 'content-type': 'application/json', 'user-agent': 'even-keel' },
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: 'error',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (response.ok) return response
    await response.body?.cancel()
    if (response.status === 401) throw new CredentialsRefused('gitlab: the token is refused (HTTP 401)')
    if (response.status === 404) throw new TrackerNotFound('gitlab: not found or the token cannot see it (HTTP 404)')
    throw new GitlabHttpError(response.status)
  }

  async rest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    return await (await this.request(`/api/v4${path}`, method, body)).json() as T
  }

  async collect<T>(path: string): Promise<T[]> {
    const result: T[] = []
    let page = '1'
    const seen = new Set<string>()
    while (page) {
      if (seen.has(page) || !/^[1-9]\d*$/.test(page)) throw new Error('gitlab: invalid pagination')
      seen.add(page)
      const response = await this.request(`/api/v4${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
      const rows = await response.json() as T[]
      result.push(...rows)
      page = response.headers.get('x-next-page') ?? (rows.length === 100 ? String(Number(page) + 1) : '')
    }
    return result
  }
}
