import { fail } from '../notice/notice.js'
import { basicAuth, JIRA_EMAIL, JIRA_MCP_TOKEN, siteUrl } from './api.js'

const ENDPOINT = 'https://mcp.atlassian.com/v2/mcp'
const PROTOCOL = '2025-06-18'

interface RpcReply {
  id?: number
  error?: unknown
  result?: { protocolVersion?: string; isError?: boolean; content?: { type: string; text?: string }[] }
}

/** Checks real site access: tools/list succeeds even for tokens that cannot call Jira tools. */
export async function checkJiraMcp(values: Readonly<Record<string, string>>, timeoutMs: number, fetchImpl: typeof fetch): Promise<void> {
  const headers = new Headers({
    authorization: `Basic ${basicAuth(values[JIRA_EMAIL]!, values[JIRA_MCP_TOKEN]!)}`,
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  })
  const signal = AbortSignal.timeout(timeoutMs)
  let session: string | null = null
  const post = async (method: string, params?: unknown, id?: number): Promise<RpcReply | undefined> => {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST', headers, signal, redirect: 'error',
      body: JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }), ...(id === undefined ? {} : { id }) }),
    })
    const received = response.headers.get('mcp-session-id')
    if (received !== null) {
      session = received
      headers.set('mcp-session-id', received)
    }
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 401 || response.status === 403) throw fail('jira.mcpToken', {})
      throw new Error(`jira MCP: HTTP ${response.status}`)
    }
    if (id === undefined) {
      await response.body?.cancel()
      return undefined
    }
    const reply = await rpcReply(response, id)
    if (reply.error !== undefined || reply.result?.isError) throw fail('jira.mcpToken', {})
    if (reply.result === undefined) throw new Error('jira MCP: missing result')
    return reply
  }
  try {
    const initialized = await post('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'even-keel', version: '1' } }, 1)
    headers.set('mcp-protocol-version', initialized?.result?.protocolVersion ?? PROTOCOL)
    await post('notifications/initialized')
    const reply = await post('tools/call', { name: 'getAccessibleAtlassianResources', arguments: {} }, 2)
    const resources: unknown[] = []
    for (const block of reply?.result?.content ?? []) {
      if (block.type !== 'text' || block.text === undefined) continue
      const parsed: unknown = JSON.parse(block.text)
      const data = (parsed as { data?: unknown } | null)?.data
      const list = Array.isArray(parsed) ? parsed : Array.isArray(data) ? data : (data as { resources?: unknown } | null)?.resources
      if (!Array.isArray(list)) throw new Error('jira MCP: invalid accessible resources')
      resources.push(...list)
    }
    const site = siteUrl(values)
    if (!resources.some((resource) => {
      const url = (resource as { url?: unknown } | null)?.url
      return typeof url === 'string' && url.trim().replace(/\/+$/, '').toLowerCase() === site.toLowerCase()
    })) throw fail('jira.mcpSite', {})
  } finally {
    if (session !== null) await fetchImpl(ENDPOINT, { method: 'DELETE', headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }).then((response) => response.body?.cancel()).catch(() => {})
  }
}

/** Streamable HTTP may return JSON or keep an SSE stream open after the reply. */
async function rpcReply(response: Response, id: number): Promise<RpcReply> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const reply = await response.json() as RpcReply
    if (reply.id !== id) throw new Error('jira MCP: unexpected reply id')
    return reply
  }
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('jira MCP: empty stream')
  const decoder = new TextDecoder()
  let pending = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      pending = (pending + decoder.decode(value, { stream: !done })).replace(/\r\n/g, '\n')
      let end: number
      while ((end = pending.indexOf('\n\n')) >= 0) {
        const event = pending.slice(0, end)
        pending = pending.slice(end + 2)
        const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        if (!data) continue
        const reply = JSON.parse(data) as RpcReply
        if (reply.id === id) return reply
      }
      if (done) throw new Error('jira MCP: stream ended without a reply')
    }
  } finally {
    await reader.cancel()
  }
}
