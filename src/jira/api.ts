import { fail } from '../notice/notice.js'
import { CredentialsRefused, TrackerNotFound } from '../tracker/source.js'

export const JIRA_URL = 'JIRA_URL'
export const JIRA_EMAIL = 'JIRA_EMAIL'
export const JIRA_TOKEN = 'JIRA_TOKEN'

/** Where Atlassian routes the REST calls of a token with scopes: the site's own address refuses such a token. */
const GATEWAY = 'https://api.atlassian.com/ex/jira'

/** The site's address, `https://<site>.atlassian.net`, without a trailing slash; the credentials go only over https. */
export function siteUrl(values: Readonly<Record<string, string | undefined>>): string {
  const value = (values[JIRA_URL] ?? '').trim().replace(/\/+$/, '')
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' && url.pathname !== '') throw new Error()
    return url.origin
  } catch {
    throw fail('jira.url', {})
  }
}

export const basicAuth = (email: string, token: string): string => Buffer.from(`${email}:${token}`).toString('base64')

export class JiraHttpError extends Error {
  constructor(readonly status: number, detail: string) {
    super(`jira: HTTP ${status}${detail ? `: ${detail}` : ''}`)
  }
}

export interface JiraUser {
  accountId: string
  displayName: string
  emailAddress?: string | null
}

export class JiraApi {
  constructor(readonly base: string, private readonly auth: string, private readonly timeoutMs: number, private readonly fetchImpl: typeof fetch = fetch) {}

  /**
   * Signs in on the site, or through Atlassian's gateway when the site refuses the token: a classic API token works on
   * the site's address, one with scopes only on `api.atlassian.com/ex/jira/<cloudId>`, and both use Basic `email:token`.
   */
  static async open(values: Readonly<Record<string, string | undefined>>, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<{ api: JiraApi; user: JiraUser }> {
    const site = siteUrl(values)
    const auth = `Basic ${basicAuth(values[JIRA_EMAIL] ?? '', values[JIRA_TOKEN] ?? '')}`
    const direct = new JiraApi(site, auth, timeoutMs, fetchImpl)
    try {
      return { api: direct, user: await direct.rest<JiraUser>('/myself') }
    } catch (error) {
      if (!(error instanceof CredentialsRefused)) throw error
    }
    const tenant = await fetchImpl(`${site}/_edge/tenant_info`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
    const cloudId = tenant.ok ? ((await tenant.json().catch(() => ({}))) as { cloudId?: unknown }).cloudId : undefined
    if (typeof cloudId !== 'string' || !/^[\w-]+$/.test(cloudId)) throw new CredentialsRefused('jira: the site refuses the e-mail and the API token (HTTP 401)')
    const gateway = new JiraApi(`${GATEWAY}/${cloudId}`, auth, timeoutMs, fetchImpl)
    return { api: gateway, user: await gateway.rest<JiraUser>('/myself') }
  }

  /** A call of REST v3: `path` goes after `/rest/api/3`. */
  async rest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await this.request(`/rest/api/3${path}`, method, body)
    if (response.status === 204) return undefined as T
    const text = await response.text()
    return (text === '' ? undefined : JSON.parse(text)) as T
  }

  async request(path: string, method = 'GET', body?: unknown): Promise<Response> {
    const response = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { authorization: this.auth, accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'even-keel' },
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: 'error',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (response.ok) return response
    const detail = errorText(await response.json().catch(() => ({})))
    if (response.status === 401) throw new CredentialsRefused(`jira: the e-mail and the API token are refused (HTTP 401)${detail ? `: ${detail}` : ''}`)
    if (response.status === 404) throw new TrackerNotFound(`jira: not found or the account cannot see it (HTTP 404)${detail ? `: ${detail}` : ''}`)
    throw new JiraHttpError(response.status, detail)
  }
}

/** Jira's error answer: `errorMessages` and the `errors` of fields. */
function errorText(body: unknown): string {
  const { errorMessages, errors } = (body ?? {}) as { errorMessages?: unknown; errors?: unknown }
  const messages = Array.isArray(errorMessages) ? errorMessages.map(String) : []
  const fields = errors !== null && typeof errors === 'object' ? Object.entries(errors).map(([field, message]) => `${field}: ${String(message)}`) : []
  return [...messages, ...fields].join('; ')
}
