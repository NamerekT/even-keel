import { fail } from '../notice/notice.js'
import { oauthHttpError } from './oauth-error.js'
export { OAuthRefused } from './oauth-error.js'

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

export const MCP_OAUTH: Readonly<Record<string, { url: string; scope?: string; authorizationOrigins?: readonly string[] }>> = {
  jira: { url: 'https://mcp.atlassian.com/v2/mcp', authorizationOrigins: ['https://auth.atlassian.com'] },
  linear: { url: 'https://mcp.linear.app/mcp', scope: 'read write', authorizationOrigins: ['https://mcp.linear.app'] },
  github: { url: 'https://api.githubcopilot.com/mcp/', scope: 'repo read:org' },
}

export interface OAuthClient { id: string; secret: string }
export interface Registration {
  server: string
  issuer: string
  requireIssuer?: boolean
  scope?: string
  clientId: string
  clientSecret?: string
  tokenEndpoint: string
  authorizationEndpoint: string
  resource: string
  redirect: string
}

export function callbackUrl(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw fail('profiles.oauthAddress', {}) }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== '/api/profiles/oauth/callback') throw fail('profiles.oauthAddress', {})
  return url.href
}

async function json(request: typeof fetch, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) })
  const body = (await response.json().catch(() => null) ?? {}) as Record<string, unknown>
  if (!response.ok || body.error) throw oauthHttpError(response.status, body.error)
  return body
}

function allowedUrl(value: unknown, origins: readonly string[]): URL {
  try {
    if (typeof value !== 'string') throw new Error()
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !origins.includes(url.origin)) throw new Error()
    return url
  } catch { throw fail('profiles.oauthFailed', {}) }
}

/** RFC 9728: the resource chooses its authorization server, within the provider's allowlist. */
async function discover(provider: typeof MCP_OAUTH[string], request: typeof fetch) {
  const resource = new URL(provider.url)
  const response = await request(provider.url, { headers: { accept: 'application/json, text/event-stream' }, redirect: 'error', signal: AbortSignal.timeout(20_000) })
  const challenge = response.status === 401 ? response.headers.get('www-authenticate') ?? '' : ''
  await response.body?.cancel()
  const parameter = (name: string) => new RegExp(`(?:^|[\\s,])${name}\\s*=\\s*(?:"([^"]*)"|([^\\s,]+))`, 'i').exec(challenge)?.slice(1).find((value) => value !== undefined)
  const advertised = parameter('resource_metadata')
  const address = allowedUrl(advertised ?? `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname === '/' ? '' : resource.pathname}`, [resource.origin])
  const protectedResource = await json(request, address.href)
  if (protectedResource.resource !== provider.url || !Array.isArray(protectedResource.authorization_servers)) throw fail('profiles.oauthFailed', {})
  const origins = provider.authorizationOrigins ?? [resource.origin]
  const issuer = protectedResource.authorization_servers.find((value) => {
    try { return !allowedUrl(value, origins).search } catch { return false }
  })
  const issuerUrl = allowedUrl(issuer, origins)
  const metadata = await json(request, `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname === '/' ? '' : issuerUrl.pathname}`)
  if (metadata.issuer !== issuer || !Array.isArray(metadata.code_challenge_methods_supported) || !metadata.code_challenge_methods_supported.includes('S256')) throw fail('profiles.oauthFailed', {})
  const endpoint = (name: string) => allowedUrl(metadata[name], origins).href
  const scopes = protectedResource.scopes_supported
  if (scopes !== undefined && (!Array.isArray(scopes) || scopes.some((value) => typeof value !== 'string' || !value || /[\s"\\]/.test(value)))) throw fail('profiles.oauthFailed', {})
  return {
    issuer: issuer as string, requireIssuer: metadata.authorization_response_iss_parameter_supported === true,
    scope: parameter('scope') || provider.scope || (Array.isArray(scopes) ? scopes.join(' ') : undefined),
    authorizationEndpoint: endpoint('authorization_endpoint'), tokenEndpoint: endpoint('token_endpoint'), registrationEndpoint: endpoint('registration_endpoint'),
  }
}

/** Providers are fixed: discovery cannot redirect a token exchange to an arbitrary host. */
export async function register(kind: string, redirect: string, request: typeof fetch, client?: OAuthClient): Promise<Registration> {
  const provider = MCP_OAUTH[kind]
  if (provider === undefined) throw fail('profiles.oauthUnsupported', {})
  if (kind === 'github') {
    if (!client?.id.trim() || !client.secret.trim()) throw fail('profiles.oauthClient', {})
    return { server: provider.url, issuer: 'https://github.com', scope: provider.scope, clientId: client.id.trim(), clientSecret: client.secret.trim(), tokenEndpoint: 'https://github.com/login/oauth/access_token', authorizationEndpoint: 'https://github.com/login/oauth/authorize', resource: '', redirect }
  }
  const { registrationEndpoint, ...discovery } = await discover(provider, request)
  const registration = await json(request, registrationEndpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Even Keel', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', ...(discovery.scope ? { scope: discovery.scope } : {}) }),
  })
  if (typeof registration.client_id !== 'string' || !registration.client_id) throw fail('profiles.oauthFailed', {})
  return { server: provider.url, clientId: registration.client_id, ...discovery, resource: provider.url, redirect }
}

export async function exchange(record: Omit<OAuthRecord, 'accessToken' | 'expiresAt'>, fields: Record<string, string>, request: typeof fetch, now: number): Promise<OAuthRecord> {
  const params = new URLSearchParams({ client_id: record.clientId, ...fields })
  if (record.clientSecret) params.set('client_secret', record.clientSecret)
  if (record.resource) params.set('resource', record.resource)
  const data = await json(request, record.tokenEndpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: params.toString() })
  if (typeof data.access_token !== 'string' || !data.access_token || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer') throw fail('profiles.oauthFailed', {})
  return {
    ...record, accessToken: data.access_token,
    ...(typeof data.refresh_token === 'string' && data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    expiresAt: typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) ? now + Math.max(0, data.expires_in) * 1000 : null,
    reconnect: false,
  }
}
