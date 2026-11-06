import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** A call of the server's tool as it arrived: its arguments and the headers of the request the gateway sent. */
export interface McpCall {
  args: Record<string, unknown>
  headers: IncomingHttpHeaders
}

/**
 * A remote MCP server of one tool, `note`, over streamable HTTP with JSON answers: a package's server that a real CLI
 * reaches only through the service's gateway. `calls` — each `tools/call` with the headers it came with.
 */
export class NoteServer {
  readonly calls: McpCall[] = []
  private http: Server | undefined

  /** The server's `/mcp` address on a free port of 127.0.0.1. */
  async start(): Promise<string> {
    const http = createServer((request, response) => {
      let raw = ''
      request.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')))
      request.on('end', () => {
        if (request.method !== 'POST') return void response.writeHead(405).end()
        const message = JSON.parse(raw) as { id?: number; method?: string; params?: { arguments?: Record<string, unknown> } }
        if (message.id === undefined) return void response.writeHead(202).end()
        if (message.method === 'tools/call') this.calls.push({ args: message.params?.arguments ?? {}, headers: request.headers })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: resultOf(message.method) }))
      })
    })
    this.http = http
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`
  }

  async close(): Promise<void> {
    const http = this.http
    this.http = undefined
    if (http === undefined) return
    http.closeAllConnections()
    await new Promise((resolve) => http.close(resolve))
  }
}

function resultOf(method: string | undefined): unknown {
  if (method === 'initialize') return { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'notes', version: '1' } }
  if (method === 'tools/list') {
    return { tools: [{ name: 'note', description: 'Keeps a note.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] }
  }
  if (method === 'tools/call') return { content: [{ type: 'text', text: 'Noted.' }] }
  return {}
}
