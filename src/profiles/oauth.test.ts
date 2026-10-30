import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { McpOAuth, type OAuthRecord } from './oauth.js'
import { OAuthRefused } from './oauth-protocol.js'

const draft = { kind: 'jira', values: { JIRA_TOKEN: 'rest-token' } }
const server = 'https://mcp.atlassian.com/v2/mcp'
const redirect = 'http://localhost:4747/api/profiles/oauth/callback'
const metadata = {
  issuer: 'https://auth.atlassian.com', authorization_endpoint: 'https://auth.atlassian.com/authorize',
  token_endpoint: 'https://auth.atlassian.com/token', registration_endpoint: 'https://auth.atlassian.com/register',
  code_challenge_methods_supported: ['S256'],
}

function fixture() {
  let record: OAuthRecord | undefined
  let now = 1_000_000
  const calls: { url: string; init?: RequestInit }[] = []
  const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (String(url) === server) return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp", scope="read write"' } })
    const data = String(url).includes('oauth-protected-resource')
      ? { resource: server, authorization_servers: [metadata.issuer], scopes_supported: ['read', 'write'] }
      : String(url).includes('.well-known') ? metadata : String(url).endsWith('/register')
      ? { client_id: 'client' } : { access_token: 'access-one', refresh_token: 'refresh-one', token_type: 'Bearer', expires_in: 60 }
    return Response.json(data)
  }) as unknown as typeof fetch
  const verify = vi.fn(async () => {})
  const log = vi.fn()
  const oauth = new McpOAuth({ fetch: request, now: () => now, get: () => record, put: async (_id, expected, next) => {
    if (record !== expected) return false
    record = next
    return true
  }, verify, log })
  const connect = async () => {
    const start = await oauth.start(draft, redirect)
    const url = new URL(start.url)
    await oauth.finish(new URLSearchParams({ state: url.searchParams.get('state')!, code: 'code' }))
    record = oauth.completed(start.flow, draft)
    return start
  }
  return { oauth, calls, request, verify, log, connect, record: () => record, tick: () => { now += 100_000 }, replace: (next?: OAuthRecord) => { record = next } }
}

describe('profile MCP OAuth', () => {
  it('logs an exchange HTTP reason once without response secrets or callback values', async () => {
    const f = fixture()
    const start = await f.oauth.start(draft, redirect)
    const state = new URL(start.url).searchParams.get('state')!
    vi.mocked(f.request).mockResolvedValueOnce(Response.json({ error: 'invalid_grant', error_description: `code=private-code state=${state}`, access_token: 'response-secret' }, { status: 400 }))
    await expect(f.oauth.finish(new URLSearchParams({ state, code: 'private-code' }))).rejects.toMatchObject({ notice: { code: 'profiles.oauthFailed' } })
    expect(f.log.mock.calls).toEqual([['profiles: jira MCP OAuth code exchange failed: HTTP 400: invalid_grant']])
    expect(f.oauth.status(start.flow)).toEqual({ state: 'failed', error: { code: 'profiles.oauthFailed', params: {} } })
  })

  it.each([
    [{ error: 'access_denied', error_description: 'The user said no' }, 'access_denied'],
    [{}, 'no code'],
  ])('shows a declined consent as denied and logs the provider error, not an exchange (%o)', async (reply, reason) => {
    const f = fixture()
    const start = await f.oauth.start(draft, redirect)
    const state = new URL(start.url).searchParams.get('state')!
    f.log.mockClear()
    await expect(f.oauth.finish(new URLSearchParams({ state, ...reply }))).rejects.toThrow()
    expect(f.log.mock.calls).toEqual([[`profiles: jira MCP OAuth consent failed: ${reason}`]])
    expect(f.oauth.status(start.flow)).toEqual({ state: 'failed', error: { code: 'profiles.oauthDenied', params: {} } })
    expect(f.calls.filter((call) => call.url === metadata.token_endpoint)).toEqual([])
  })

  it('does not call a grant refused by the MCP check a declined consent', async () => {
    const f = fixture()
    const start = await f.oauth.start(draft, redirect)
    f.verify.mockRejectedValueOnce(new OAuthRefused('MCP check: HTTP 401'))
    await expect(f.oauth.finish(new URLSearchParams({ state: new URL(start.url).searchParams.get('state')!, code: 'code' }))).rejects.toThrow()
    expect(f.log.mock.calls).toEqual([['profiles: jira MCP OAuth grant verification failed: MCP check: HTTP 401']])
    expect(f.oauth.status(start.flow)).toEqual({ state: 'failed', error: { code: 'profiles.oauthFailed', params: {} } })
  })

  it('logs a grant check exception on one line, redacting known credentials and callback secrets', async () => {
    const f = fixture()
    const start = await f.oauth.start(draft, redirect)
    const url = new URL(start.url)
    const state = url.searchParams.get('state')!
    f.verify.mockRejectedValueOnce(new Error(`MCP check: HTTP 503\naccess-one refresh-one rest-token private-code ${state}`))
    await expect(f.oauth.finish(new URLSearchParams({ state, code: 'private-code' }))).rejects.toThrow()
    expect(f.log.mock.calls).toEqual([['profiles: jira MCP OAuth grant verification failed: MCP check: HTTP 503 [redacted] [redacted] [redacted] [redacted] [redacted]']])
    expect(f.oauth.status(start.flow)).toEqual({ state: 'failed', error: { code: 'profiles.oauthFailed', params: {} } })
  })

  it('logs registration exceptions without exposing draft credentials', async () => {
    const f = fixture()
    vi.mocked(f.request).mockRejectedValueOnce(new Error('registration unavailable\nrest-token'))
    await expect(f.oauth.start(draft, redirect)).rejects.toMatchObject({ notice: { code: 'profiles.oauthFailed' } })
    expect(f.log.mock.calls).toEqual([['profiles: jira MCP OAuth registration failed: registration unavailable [redacted]']])
  })

  it('redacts encoded code and verifier from a request exception', async () => {
    const f = fixture()
    const start = await f.oauth.start(draft, redirect)
    const state = new URL(start.url).searchParams.get('state')!
    vi.mocked(f.request).mockImplementationOnce(async (_url, init) => { throw new Error(`Request failed: ${init?.body}`) })
    await expect(f.oauth.finish(new URLSearchParams({ state, code: 'private code/%' }))).rejects.toThrow()
    expect(f.log).toHaveBeenCalledTimes(1)
    const line = f.log.mock.calls[0]![0]
    expect(line).toContain('jira MCP OAuth code exchange failed: Request failed:')
    for (const secret of ['private', state]) expect(line).not.toContain(secret)
    expect(line).toContain('code_verifier=[redacted]')
  })

  it.each([new Response('unavailable', { status: 502 }), Response.json(null, { status: 502 })])('keeps the HTTP status when an error has no JSON object', async (response) => {
    const f = fixture()
    const start = await f.oauth.start(draft, redirect)
    vi.mocked(f.request).mockResolvedValueOnce(response)
    await expect(f.oauth.finish(new URLSearchParams({ state: new URL(start.url).searchParams.get('state')!, code: 'code' }))).rejects.toThrow()
    expect(f.log.mock.calls).toEqual([['profiles: jira MCP OAuth code exchange failed: HTTP 502']])
  })

  it.each([false, true])('logs a refused refresh for a stored or draft grant (draft: %s)', async (unsaved) => {
    const f = fixture()
    const start = await f.connect()
    f.tick()
    vi.mocked(f.request).mockResolvedValueOnce(Response.json({ error: 'invalid_grant', refresh_token: 'refresh-one' }, { status: 400 }))
    const result = unsaved ? f.oauth.check(start.flow, draft.kind, draft.values, draft) : f.oauth.token('p')
    await expect(result).rejects.toMatchObject({ notice: { code: 'profiles.oauthReconnect' } })
    expect(f.log.mock.calls).toEqual([['profiles: jira MCP OAuth refresh failed: HTTP 400: invalid_grant']])
  })

  it('checks and refreshes an unsaved grant without persisting it, keeping its original deadline', async () => {
    const f = fixture()
    const start = await f.connect()
    f.replace()
    f.tick()
    vi.mocked(f.request).mockResolvedValueOnce(Response.json({ access_token: 'renewed', token_type: 'Bearer', expires_in: 3600 }))
    const record = await f.oauth.check(start.flow, draft.kind, draft.values, draft)
    expect(record.accessToken).toBe('renewed')
    expect(f.oauth.completed(start.flow, draft)).toBe(record)
    expect(f.record()).toBeUndefined()
    expect(f.verify).toHaveBeenLastCalledWith(draft.kind, draft.values, 'renewed')
    for (let i = 0; i < 5; i++) f.tick()
    await expect(f.oauth.check(start.flow, draft.kind, draft.values, draft)).rejects.toMatchObject({ notice: { code: 'profiles.oauthExpired' } })
  })

  it('retries a rejected stored access token once and marks a second refusal for reconnecting', async () => {
    const f = fixture()
    await f.connect()
    f.verify.mockRejectedValue(new OAuthRefused())
    await expect(f.oauth.check('p', draft.kind, draft.values)).rejects.toMatchObject({ notice: { code: 'profiles.oauthReconnect' } })
    expect(f.verify).toHaveBeenCalledTimes(3)
    expect(f.record()?.reconnect).toBe(true)
  })

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
    expect(() => f.oauth.completed(start.flow, { ...draft, values: { JIRA_TOKEN: 'other' } })).toThrow()
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
    const restarted = new McpOAuth({ get: () => f.record(), put: async () => false, verify: async () => {}, now: () => 1_100_000, log: () => {} })
    expect(await restarted.token('p')).toBe('access-two')
    vi.mocked(f.request).mockResolvedValueOnce(Response.json({ access_token: 'access-three', refresh_token: 'refresh-three', token_type: 'Bearer', expires_in: 3600 }))
    expect(await f.oauth.token('p', 'access-two')).toBe('access-three')
    const params = new URLSearchParams(vi.mocked(f.request).mock.calls.at(-1)![1]!.body as string)
    expect(params.get('refresh_token')).toBe('refresh-two')
    expect(params.get('resource')).toBe(server)
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
