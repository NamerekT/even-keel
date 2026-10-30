import { NoticeError } from '../notice/notice.js'
import { checkJiraMcp } from '../jira/mcp.js'
import type { TrackerUser } from '../tracker/source.js'
import { OAuthRefused } from './oauth-protocol.js'
import { oauthHttpError } from './oauth-error.js'

/**
 * A profile check proves MCP access separately from its REST credentials and names the grant's person when it can;
 * only Jira has MCP OAuth (`MCP_OAUTH`).
 */
export async function checkMcpOAuth(values: Record<string, string>, token: string, timeoutMs: number): Promise<TrackerUser | undefined> {
  let failure: Error | undefined
  const request: typeof fetch = async (url, init) => {
    const response = await fetch(url, init)
    if (!response.ok && init?.method !== 'DELETE') {
      const body = await response.clone().json().catch(() => null) as { error?: unknown } | null
      failure = oauthHttpError(response.status, body?.error, response.status === 401 || response.status === 403)
    }
    return response
  }
  try { return await checkJiraMcp(values, timeoutMs, request, `Bearer ${token}`) }
  catch (error) {
    if (failure) throw failure
    if (error instanceof NoticeError && error.notice.code === 'jira.mcpToken') throw new OAuthRefused()
    throw error
  }
}
