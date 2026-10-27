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
    await expect(checkMcpOAuth('jira', {}, 'access', 1000)).rejects.toThrow('HTTP 401: invalid_token')
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1]![1]?.method).toBe('DELETE')
    expect(new Headers(request.mock.calls[1]![1]?.headers).get('mcp-session-id')).toBe('probe')
  })

  it.each(['jira', 'linear', 'github'])('preserves the HTTP refusal reason for %s without response details', async (kind) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'invalid_token', error_description: 'private-token' }, { status: 401 })))
    await expect(checkMcpOAuth(kind, {}, 'access', 1000)).rejects.toThrow('HTTP 401: invalid_token')
    await expect(checkMcpOAuth(kind, {}, 'access', 1000)).rejects.toBeInstanceOf(OAuthRefused)
  })

  it.each(['linear', 'github'])('initializes %s with Bearer auth and closes the probe session', async (kind) => {
    const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access')
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      expect(JSON.parse(String(init?.body)).method).toBe('initialize')
      return Response.json({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } }, { headers: { 'mcp-session-id': 'probe' } })
    })
    vi.stubGlobal('fetch', request)
    await checkMcpOAuth(kind, {}, 'access', 1000)
    expect(request).toHaveBeenCalledTimes(2)
    expect(new Headers(request.mock.calls[1]![1]?.headers).get('mcp-session-id')).toBe('probe')
  })

  it('distinguishes authorization refusal from transient and RPC errors, including SSE', async () => {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    request.mockResolvedValueOnce(new Response(null, { status: 401 }))
    await expect(checkMcpOAuth('linear', {}, 'access', 1000)).rejects.toBeInstanceOf(OAuthRefused)
    request.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(checkMcpOAuth('linear', {}, 'access', 1000)).rejects.not.toBeInstanceOf(OAuthRefused)
    request.mockResolvedValueOnce(new Response('data: {"jsonrpc":"2.0","id":1,"error":{"code":-32000}}\n\n', { headers: { 'content-type': 'text/event-stream' } }))
    await expect(checkMcpOAuth('linear', {}, 'access', 1000)).rejects.toThrow('initialization failed')
  })
})
