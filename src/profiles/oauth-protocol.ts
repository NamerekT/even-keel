import { fail } from '../notice/notice.js'

/** OAuth endpoints and tokens stay in the service, outside the environment and the page's state. */
export interface OAuthRecord {
  server: string
  clientId: string
  clientSecret?: string
  tokenEndpoint: string
  redirect: string
  resource: string
  accessToken: string
  refreshToken?: string
  expiresAt: number | null
  reconnect?: boolean
}

export const MCP_OAUTH: Readonly<Record<string, { url: string; scope?: string }>> = {
  jira: { url: 'https://mcp.atlassian.com/v2/mcp' },
  linear: { url: 'https://mcp.linear.app/mcp', scope: 'read write' },
  github: { url: 'https://api.githubcopilot.com/mcp/', scope: 'repo read:org' },
}

export interface OAuthClient { id: string; secret: string }
export interface Registration {
  server: string
  clientId: string
  clientSecret?: string
  tokenEndpoint: string
  authorizationEndpoint: string
  resource: string
  redirect: string
}

export class OAuthRefused extends Error {}

export function callbackUrl(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw fail('profiles.oauthAddress', {}) }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== '/api/profiles/oauth/callback') throw fail('profiles.oauthAddress', {})
  return url.href
}

async function json(request: typeof fetch, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    if (response.status === 401 || body.error === 'invalid_grant' || body.error === 'invalid_client') throw new OAuthRefused()
    throw fail('profiles.oauthFailed', {})
  }
  return body
}

/** Providers are fixed: discovery cannot redirect a token exchange to an arbitrary host. */
export async function register(kind: string, redirect: string, request: typeof fetch, client?: OAuthClient): Promise<Registration> {
  const provider = MCP_OAUTH[kind]
  if (provider === undefined) throw fail('profiles.oauthUnsupported', {})
  if (kind === 'github') {
    if (!client?.id.trim() || !client.secret.trim()) throw fail('profiles.oauthClient', {})
    return { server: provider.url, clientId: client.id.trim(), clientSecret: client.secret.trim(), tokenEndpoint: 'https://github.com/login/oauth/access_token', authorizationEndpoint: 'https://github.com/login/oauth/authorize', resource: '', redirect }
  }
  const origin = new URL(provider.url).origin
  const metadata = await json(request, `${origin}/.well-known/oauth-authorization-server`)
  if (metadata.issuer !== origin || !Array.isArray(metadata.code_challenge_methods_supported) || !metadata.code_challenge_methods_supported.includes('S256')) throw fail('profiles.oauthFailed', {})
  const endpoint = (name: string) => {
    const value = metadata[name]
    if (typeof value !== 'string' || new URL(value).origin !== origin) throw fail('profiles.oauthFailed', {})
    return value
  }
  const registration = await json(request, endpoint('registration_endpoint'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Even Keel', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
  })
  if (typeof registration.client_id !== 'string' || !registration.client_id) throw fail('profiles.oauthFailed', {})
  return { server: provider.url, clientId: registration.client_id, ...(typeof registration.client_secret === 'string' ? { clientSecret: registration.client_secret } : {}), tokenEndpoint: endpoint('token_endpoint'), authorizationEndpoint: endpoint('authorization_endpoint'), resource: provider.url, redirect }
}

export async function exchange(record: Omit<OAuthRecord, 'accessToken' | 'expiresAt'>, fields: Record<string, string>, request: typeof fetch, now: number): Promise<OAuthRecord> {
  const params = new URLSearchParams({ client_id: record.clientId, ...fields })
  if (record.clientSecret) params.set('client_secret', record.clientSecret)
  if (record.resource) params.set('resource', record.resource)
  const data = await json(request, record.tokenEndpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: params.toString() })
  if (data.error === 'bad_verification_code') throw new OAuthRefused()
  if (typeof data.access_token !== 'string' || !data.access_token || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer') throw fail('profiles.oauthFailed', {})
  return {
    ...record, accessToken: data.access_token,
    ...(typeof data.refresh_token === 'string' && data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    expiresAt: typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) ? now + Math.max(0, data.expires_in) * 1000 : null,
    reconnect: false,
  }
}
