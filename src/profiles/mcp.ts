import { NoticeError } from '../notice/notice.js'
import { checkJiraMcp, rpcReply } from '../jira/mcp.js'
import { MCP_OAUTH, OAuthRefused } from './oauth-protocol.js'

/** A profile check proves MCP access separately from its REST credentials. */
export async function checkMcpOAuth(kind: string, values: Record<string, string>, token: string, timeoutMs: number): Promise<void> {
  if (kind === 'jira') {
    try { await checkJiraMcp(values, timeoutMs, fetch, `Bearer ${token}`) }
    catch (error) {
      if (error instanceof NoticeError && error.notice.code === 'jira.mcpToken') throw new OAuthRefused()
      throw error
    }
    return
  }
  const url = MCP_OAUTH[kind]!.url
  const headers = new Headers({ authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' })
  const response = await fetch(url, { method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'even-keel', version: '1' } } }) })
  try {
    if (response.status === 401 || response.status === 403) throw new OAuthRefused()
    if (!response.ok) throw new Error(`MCP check: HTTP ${response.status}`)
    const reply = await rpcReply(response, 1)
    if (reply.error || !reply.result?.protocolVersion) throw new Error('MCP check: initialization failed')
  } finally {
    await response.body?.cancel().catch(() => {})
    const session = response.headers.get('mcp-session-id')
    if (session) {
      headers.set('mcp-session-id', session)
      await fetch(url, { method: 'DELETE', headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }).then((reply) => reply.body?.cancel()).catch(() => {})
    }
  }
}
