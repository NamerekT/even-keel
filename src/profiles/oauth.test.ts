import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { McpOAuth, type OAuthRecord } from './oauth.js'

const draft = { kind: 'linear', values: { LINEAR_TOKEN: 'rest-token' } }
const redirect = 'http://localhost:4747/api/profiles/oauth/callback'
const metadata = {
  issuer: 'https://mcp.linear.app', authorization_endpoint: 'https://mcp.linear.app/authorize',
  token_endpoint: 'https://mcp.linear.app/token', registration_endpoint: 'https://mcp.linear.app/register',
  code_challenge_methods_supported: ['S256'],
}

function fixture() {
  let record: OAuthRecord | undefined
  let now = 1_000_000
  const calls: { url: string; init?: RequestInit }[] = []
  const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (String(url) === 'https://mcp.linear.app/mcp') return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://mcp.linear.app/.well-known/oauth-protected-resource/mcp", scope="read write"' } })
    const data = String(url).includes('oauth-protected-resource')
      ? { resource: 'https://mcp.linear.app/mcp', authorization_servers: [metadata.issuer], scopes_supported: ['read', 'write'] }
      : String(url).includes('.well-known') ? metadata : String(url).endsWith('/register')
      ? { client_id: 'client' } : { access_token: 'access-one', refresh_token: 'refresh-one', token_type: 'Bearer', expires_in: 60 }
    return Response.json(data)
  }) as unknown as typeof fetch
  const oauth = new McpOAuth({ fetch: request, now: () => now, get: () => record, put: async (_id, expected, next) => {
    if (record !== expected) return false
    record = next
    return true
  }, verify: async () => {} })
  const connect = async () => {
    const start = await oauth.start(draft, redirect)
    const url = new URL(start.url)
    await oauth.finish(new URLSearchParams({ state: url.searchParams.get('state')!, code: 'code' }))
    record = oauth.completed(start.flow, draft)
    return start
  }
  return { oauth, calls, request, connect, record: () => record, tick: () => { now += 100_000 }, replace: (next?: OAuthRecord) => { record = next } }
}

describe('profile MCP OAuth', () => {
  it('binds PKCE and the one-use callback to a draft without returning credentials', async () => {
    const f = fixture()
    const start = await f.oauth.start(draft, redirect)
    const url = new URL(start.url)
    expect(url.searchParams.get('redirect_uri')).toBe(redirect)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    const callback = new URLSearchParams({ state: url.searchParams.get('state')!, code: 'code' })
    await f.oauth.finish(callback)
    const body = new URLSearchParams(f.calls.at(-1)!.init!.body as string)
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(url.searchParams.get('code_challenge'))
    expect(f.oauth.status(start.flow)).toEqual({ state: 'ready', error: null })
    expect(JSON.stringify(start)).not.toContain('access-one')
    expect(() => f.oauth.completed(start.flow, { ...draft, values: { LINEAR_TOKEN: 'other' } })).toThrow()
    await expect(f.oauth.finish(callback)).rejects.toThrow()
    expect(f.oauth.completed(start.flow, draft).accessToken).toBe('access-one')
  })

  it('rejects forged state, expired flows and insecure remote callbacks', async () => {
    const f = fixture()
    await expect(f.oauth.finish(new URLSearchParams({ state: 'forged', code: 'code' }))).rejects.toThrow()
    await expect(f.oauth.start(draft, 'http://remote.example.com/api/profiles/oauth/callback')).rejects.toThrow()
    const start = await f.oauth.start(draft, redirect)
    for (let i = 0; i < 10; i++) f.tick()
    expect(() => f.oauth.status(start.flow)).toThrow()
  })

  it('shares a refresh, persists rotated credentials, and survives service restart', async () => {
    const f = fixture()
    await f.connect()
    f.tick()
    vi.mocked(f.request).mockResolvedValue(Response.json({ access_token: 'access-two', refresh_token: 'refresh-two', token_type: 'Bearer', expires_in: 3600 }))
    const before = f.calls.length
    expect(await Promise.all([f.oauth.token('p'), f.oauth.token('p')])).toEqual(['access-two', 'access-two'])
    expect(vi.mocked(f.request).mock.calls.length).toBe(before + 1)
    expect(f.record()?.refreshToken).toBe('refresh-two')
    const restarted = new McpOAuth({ get: () => f.record(), put: async () => false, verify: async () => {}, now: () => 1_100_000 })
    expect(await restarted.token('p')).toBe('access-two')
    vi.mocked(f.request).mockResolvedValueOnce(Response.json({ access_token: 'access-three', refresh_token: 'refresh-three', token_type: 'Bearer', expires_in: 3600 }))
    expect(await f.oauth.token('p', 'access-two')).toBe('access-three')
    const params = new URLSearchParams(vi.mocked(f.request).mock.calls.at(-1)![1]!.body as string)
    expect(params.get('refresh_token')).toBe('refresh-two')
    expect(params.get('resource')).toBe('https://mcp.linear.app/mcp')
    expect(f.record()?.refreshToken).toBe('refresh-three')
  })

  it('marks revoked grants for reconnection but keeps transient failures retryable', async () => {
    const f = fixture()
    await f.connect()
    f.tick()
    vi.mocked(f.request).mockResolvedValueOnce(Response.json({}, { status: 503 }))
    await expect(f.oauth.token('p')).rejects.toThrow()
    expect(f.record()?.reconnect).not.toBe(true)
    vi.mocked(f.request).mockResolvedValueOnce(Response.json({ error: 'invalid_grant' }, { status: 400 }))
    await expect(f.oauth.token('p')).rejects.toThrow()
    expect(f.record()?.reconnect).toBe(true)
  })

  it('does not resurrect disconnected credentials when a refresh completes late', async () => {
    const f = fixture()
    await f.connect()
    f.tick()
    vi.mocked(f.request).mockImplementationOnce(async () => {
      f.replace()
      return Response.json({ access_token: 'late', token_type: 'Bearer', expires_in: 3600 })
    })
    await expect(f.oauth.token('p')).rejects.toThrow()
    expect(f.record()).toBeUndefined()
  })
})
