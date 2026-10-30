import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkMcpOAuth } from './mcp.js'
import { OAuthRefused } from './oauth-protocol.js'

afterEach(() => vi.unstubAllGlobals())

describe('MCP OAuth access check', () => {
  it('keeps Jira probe cleanup when preserving a refusal with a session header', async () => {
    const request = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : Response.json({ error: 'invalid_token' }, { status: 401, headers: { 'mcp-session-id': 'probe' } }))
    vi.stubGlobal('fetch', request)
    await expect(checkMcpOAuth({}, 'access', 1000)).rejects.toThrow('HTTP 401: invalid_token')
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1]![1]?.method).toBe('DELETE')
    expect(new Headers(request.mock.calls[1]![1]?.headers).get('mcp-session-id')).toBe('probe')
  })

  it('preserves the HTTP refusal reason without response details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'invalid_token', error_description: 'private-token' }, { status: 401 })))
    await expect(checkMcpOAuth({}, 'access', 1000)).rejects.toThrow('HTTP 401: invalid_token')
    await expect(checkMcpOAuth({}, 'access', 1000)).rejects.toBeInstanceOf(OAuthRefused)
  })

  it('distinguishes authorization refusal from a transient error', async () => {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    request.mockResolvedValueOnce(new Response(null, { status: 401 }))
    await expect(checkMcpOAuth({}, 'access', 1000)).rejects.toBeInstanceOf(OAuthRefused)
    request.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(checkMcpOAuth({}, 'access', 1000)).rejects.not.toBeInstanceOf(OAuthRefused)
  })
})
