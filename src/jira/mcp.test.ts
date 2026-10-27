import { describe, expect, it } from 'vitest'
import { checkJiraMcp } from './mcp.js'

const VALUES = { JIRA_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'john.doe@example.com', JIRA_TOKEN: 'rest-token', JIRA_MCP_TOKEN: 'mcp-token' }
const result = { content: [{ type: 'text', text: JSON.stringify([{ id: 'cloud-1', url: `${VALUES.JIRA_URL}/` }]) }] }

function server(toolReply: unknown = { id: 2, result }, status = 200) {
  const calls: { method: string; headers: Headers; body?: Record<string, unknown> }[] = []
  let cancelled = false
  const fetchImpl: typeof fetch = async (_url, init) => {
    const headers = new Headers(init?.headers)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    calls.push({ method: init?.method ?? 'GET', headers, ...(body ? { body } : {}) })
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    if (body?.method === 'initialize') return Response.json({ id: 1, result: { protocolVersion: '2025-06-18' } }, { headers: { 'mcp-session-id': 'test-session' } })
    if (body?.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (status !== 200) return new Response(null, { status })
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(': keepalive\r'))
        controller.enqueue(encoder.encode('\n\r\ndata: {"method":"notifications/progress"}\r\n\r\n'))
        controller.enqueue(encoder.encode(`event: message\r\ndata: ${JSON.stringify(toolReply)}\r\n\r\n`))
        // The remote leaves the stream open: the checker must stop at its reply.
      },
      cancel() { cancelled = true },
    })
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
  }
  return { fetchImpl, calls, cancelled: () => cancelled }
}

describe('Jira MCP profile check', () => {
  it('reads an SSE reply, cancels the open stream and closes the negotiated session', async () => {
    const fake = server()
    await checkJiraMcp(VALUES, 1000, fake.fetchImpl)
    expect(fake.cancelled()).toBe(true)
    expect(fake.calls.map((call) => call.body?.method ?? call.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call', 'DELETE'])
    for (const call of fake.calls.slice(1)) {
      expect(call.headers.get('mcp-session-id')).toBe('test-session')
      expect(call.headers.get('mcp-protocol-version')).toBe('2025-06-18')
    }
  })

  it('accepts the data.resources envelope returned by the live MCP v2 tool', async () => {
    const fake = server({ id: 2, result: { content: [{ type: 'text', text: JSON.stringify({ data: { resources: [{ cloudId: 'cloud-1', url: VALUES.JIRA_URL, products: [{ id: 'jira', access: 'read-write' }] }] } }) }] } })
    await expect(checkJiraMcp(VALUES, 1000, fake.fetchImpl)).resolves.toBeUndefined()
  })

  it.each([401, 403])('offers a new MCP token after HTTP %s and still closes the session', async (status) => {
    const fake = server(undefined, status)
    await expect(checkJiraMcp(VALUES, 1000, fake.fetchImpl)).rejects.toMatchObject({ notice: { code: 'jira.mcpToken' } })
    expect(fake.calls.at(-1)?.method).toBe('DELETE')
  })

  it.each([
    { id: 2, error: { code: -32000, message: 'Unable to resolve user scopes' } },
    { id: 2, result: { isError: true, content: [{ type: 'text', text: 'Cloud id is not explicitly granted' }] } },
  ])('rejects protocol and tool errors without relying on the tools list', async (reply) => {
    const fake = server(reply)
    await expect(checkJiraMcp(VALUES, 1000, fake.fetchImpl)).rejects.toMatchObject({ notice: { code: 'jira.mcpToken' } })
    expect(fake.cancelled()).toBe(true)
  })

  it('does not confuse server failures with refused credentials', async () => {
    const fake = server(undefined, 503)
    await expect(checkJiraMcp(VALUES, 1000, fake.fetchImpl)).rejects.toThrow('jira MCP: HTTP 503')
  })
})
