import { describe, expect, it, vi } from 'vitest'
import { McpOAuth } from './oauth.js'
import { register } from './oauth-protocol.js'

const server = 'https://mcp.atlassian.com/v2/mcp'
const resourceMetadata = 'https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp'
const issuer = 'https://auth.atlassian.com/test-tenant'
const issuerMetadata = 'https://auth.atlassian.com/.well-known/oauth-authorization-server/test-tenant'
const redirect = 'http://localhost:4747/api/profiles/oauth/callback'
const scope = 'read:jira:agent-interface write:jira:agent-interface read:me offline_access'

function fixture(challenge = `Bearer resource_metadata="${resourceMetadata}"`) {
  const resource = { resource: server, authorization_servers: [issuer], scopes_supported: scope.split(' ') }
  const metadata = {
    issuer, authorization_endpoint: 'https://auth.atlassian.com/authorize',
    token_endpoint: 'https://auth.atlassian.com/oauth/token', registration_endpoint: `${issuer}/dcr/register`,
    code_challenge_methods_supported: ['S256'],
  }
  const responses = new Map<string, () => Response>([
    [server, () => new Response(null, { status: 401, headers: { 'www-authenticate': challenge } })],
    [resourceMetadata, () => Response.json(resource)],
    [issuerMetadata, () => Response.json(metadata)],
    [metadata.registration_endpoint, () => Response.json({ client_id: 'public-client', client_secret: 'unused-secret' })],
    [metadata.token_endpoint, () => Response.json({ access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 3600 })],
  ])
  const request = vi.fn(async (url: string | URL | Request) => {
    const response = responses.get(String(url))
    if (!response) throw new Error(`Unexpected URL: ${String(url)}`)
    return response()
  }) as unknown as typeof fetch
  const verify = vi.fn(async () => {})
  const oauth = new McpOAuth({ fetch: request, get: () => undefined, put: async () => false, verify })
  return { resource, metadata, responses, request, oauth, verify }
}

describe('MCP resource OAuth discovery', () => {
  it('uses the resource authorization server, registers scopes and exchanges as a public client', async () => {
    const f = fixture()
    const draft = { kind: 'jira', values: { JIRA_URL: 'https://example.atlassian.net' } }
    const start = await f.oauth.start(draft, redirect)
    const url = new URL(start.url)
    expect(url.origin + url.pathname).toBe(f.metadata.authorization_endpoint)
    expect(url.searchParams.get('scope')).toBe(scope)
    expect(url.searchParams.get('resource')).toBe(server)
    expect(url.searchParams.has('audience')).toBe(false)
    const registration = vi.mocked(f.request).mock.calls.find(([target]) => target === f.metadata.registration_endpoint)!
    expect(JSON.parse(registration[1]!.body as string)).toMatchObject({ scope, token_endpoint_auth_method: 'none', redirect_uris: [redirect] })
    await f.oauth.finish(new URLSearchParams({ code: 'code', state: url.searchParams.get('state')!, iss: issuer }))
    const token = vi.mocked(f.request).mock.calls.at(-1)!
    expect(token[0]).toBe(f.metadata.token_endpoint)
    const params = new URLSearchParams(token[1]!.body as string)
    expect(params.get('resource')).toBe(server)
    expect(params.has('client_secret')).toBe(false)
    expect(f.verify).toHaveBeenCalledWith('jira', draft.values, 'access')
    expect(f.oauth.completed(start.flow, draft)).toMatchObject({ server, refreshToken: 'refresh', tokenEndpoint: f.metadata.token_endpoint })
    expect(vi.mocked(f.request).mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true)
  })

  it('uses a challenge metadata URL even when it differs from the well-known path', async () => {
    const custom = 'https://mcp.atlassian.com/metadata'
    const f = fixture(`Bearer resource_metadata="${custom}"`)
    f.responses.set(custom, () => Response.json(f.resource))
    f.responses.delete(resourceMetadata)
    await expect(register('jira', redirect, f.request)).resolves.toMatchObject({ resource: server })
  })

  it('falls back to the resource path without a resource_metadata challenge', async () => {
    const f = fixture('Bearer')
    await expect(register('jira', redirect, f.request)).resolves.toMatchObject({ resource: server })
    expect(f.request).toHaveBeenCalledWith(resourceMetadata, expect.anything())
  })

  it('prefers challenge scopes over the resource supported scopes', async () => {
    const f = fixture(`Bearer resource_metadata="${resourceMetadata}", scope="read:me offline_access"`)
    const start = await f.oauth.start({ kind: 'jira', values: {} }, redirect)
    expect(new URL(start.url).searchParams.get('scope')).toBe('read:me offline_access')
    const registration = vi.mocked(f.request).mock.calls.at(-1)!
    expect(JSON.parse(registration[1]!.body as string).scope).toBe('read:me offline_access')
  })

  it.each(['https://evil.example/metadata', 'https://user:password@mcp.atlassian.com/metadata', 'http://mcp.atlassian.com/metadata'])(
    'refuses an unsafe resource metadata URL: %s', async (url) => {
      const f = fixture(`Bearer resource_metadata="${url}"`)
      await expect(register('jira', redirect, f.request)).rejects.toThrow()
      expect(f.request).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['https://evil.example/issuer', 'https://mcp.atlassian.com', 'http://auth.atlassian.com/issuer'])(
    'refuses authorization servers outside the provider allowlist: %s', async (url) => {
      const f = fixture()
      f.resource.authorization_servers = [url]
      await expect(register('jira', redirect, f.request)).rejects.toThrow()
      expect(f.request).toHaveBeenCalledTimes(2)
    },
  )

  it.each(['authorization_endpoint', 'token_endpoint', 'registration_endpoint'] as const)(
    'validates %s before registering a client', async (name) => {
      const f = fixture()
      f.metadata[name] = 'https://evil.example/endpoint'
      await expect(register('jira', redirect, f.request)).rejects.toThrow()
      expect(f.request).toHaveBeenCalledTimes(3)
    },
  )

  it('refuses a resource mismatch, an issuer mismatch and missing S256', async () => {
    for (const change of ['resource', 'issuer', 'pkce']) {
      const f = fixture()
      if (change === 'resource') f.resource.resource = 'https://mcp.atlassian.com/v1/mcp'
      if (change === 'issuer') f.metadata.issuer = 'https://auth.atlassian.com/other-tenant'
      if (change === 'pkce') f.metadata.code_challenge_methods_supported = ['plain']
      await expect(register('jira', redirect, f.request)).rejects.toThrow()
    }
  })

  it('rejects a callback issuer mismatch before sending the code', async () => {
    const f = fixture()
    const start = await f.oauth.start({ kind: 'jira', values: {} }, redirect)
    const before = vi.mocked(f.request).mock.calls.length
    await expect(f.oauth.finish(new URLSearchParams({ code: 'code', state: new URL(start.url).searchParams.get('state')!, iss: 'https://auth.atlassian.com/other-tenant' }))).rejects.toThrow()
    expect(f.request).toHaveBeenCalledTimes(before)
  })

  it('requires the callback issuer when the authorization server advertises it', async () => {
    const f = fixture()
    f.responses.set(issuerMetadata, () => Response.json({ ...f.metadata, authorization_response_iss_parameter_supported: true }))
    const start = await f.oauth.start({ kind: 'jira', values: {} }, redirect)
    const before = vi.mocked(f.request).mock.calls.length
    await expect(f.oauth.finish(new URLSearchParams({ code: 'code', state: new URL(start.url).searchParams.get('state')! }))).rejects.toThrow()
    expect(f.request).toHaveBeenCalledTimes(before)
  })

  it('keeps GitHub on its configured OAuth App without dynamic registration', async () => {
    const request = vi.fn(async () => Response.json({ access_token: 'github-access', token_type: 'bearer' })) as unknown as typeof fetch
    const oauth = new McpOAuth({ fetch: request, get: () => undefined, put: async () => false, verify: async () => {} })
    const draft = { kind: 'github', values: {} }
    const start = await oauth.start(draft, redirect, { id: 'app-client', secret: 'app-secret' })
    const url = new URL(start.url)
    expect(url.origin).toBe('https://github.com')
    expect(url.searchParams.get('scope')).toBe('repo read:org')
    expect(request).not.toHaveBeenCalled()
    await oauth.finish(new URLSearchParams({ code: 'code', state: url.searchParams.get('state')! }))
    const params = new URLSearchParams(vi.mocked(request).mock.calls[0]![1]!.body as string)
    expect(params.get('client_secret')).toBe('app-secret')
    expect(oauth.completed(start.flow, draft).server).toBe('https://api.githubcopilot.com/mcp/')
  })
})
