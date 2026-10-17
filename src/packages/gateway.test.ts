import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { McpGateway, refusal, type GatewayTarget } from './gateway.js'
import { routeOf } from './launch.js'

const ECHO = `
const lines = require('node:readline').createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { method: message.method, key: process.env.KEY ?? null } }) + '\\n')
})
`

describe('refusal', () => {
  const json = { host: '127.0.0.1:4748', 'content-type': 'application/json' }

  it('lets a local JSON request through', () => {
    expect(refusal('POST', json)).toBeNull()
    expect(refusal('GET', { host: 'localhost:4748' })).toBeNull()
  })

  it('refuses another host: a DNS rebinding page names its own', () => {
    expect(refusal('POST', { ...json, host: 'evil.example.com:4748' })).toBe(403)
    expect(refusal('POST', { 'content-type': 'application/json' })).toBe(403)
  })

  it('refuses any request a browser page sends', () => {
    expect(refusal('POST', { ...json, origin: 'http://127.0.0.1:4747' })).toBe(403)
  })

  it('refuses a POST that is not JSON: a form posts without a preflight', () => {
    expect(refusal('POST', { host: '127.0.0.1', 'content-type': 'text/plain' })).toBe(415)
    expect(refusal('POST', { host: '127.0.0.1' })).toBe(415)
  })
})

describe('McpGateway', () => {
  let gateway: McpGateway | undefined
  let upstream: Server | undefined

  afterEach(async () => {
    await gateway?.close()
    await new Promise((resolve) => (upstream === undefined ? resolve(undefined) : upstream.close(resolve)))
    gateway = upstream = undefined
  })

  const start = async (target: GatewayTarget | null) => {
    gateway = new McpGateway({ resolve: () => target, baseEnv: () => ({ PATH: process.env.PATH }), log: () => {} })
    await gateway.listen(0)
    return `${gateway.origin}${routeOf('p-1', 'echo', 'i1', 'echo')}`
  }

  const post = (url: string, body: unknown, session?: string) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(session === undefined ? {} : { 'mcp-session-id': session }) }, body: JSON.stringify(body) })

  it('bridges a stdio server: a process per MCP session, replies matched by id', async () => {
    const url = await start({ entry: { command: 'node', args: ['-e', ECHO] }, npm: null, env: { KEY: 'secret' } })
    const first = await post(url, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(first.status).toBe(200)
    const session = first.headers.get('mcp-session-id')!
    expect(await first.json()).toMatchObject({ id: 1, result: { method: 'initialize', key: 'secret' } })
    expect((await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, session)).status).toBe(202)
    expect(await (await post(url, [{ jsonrpc: '2.0', id: 'a', method: 'tools/list' }], session)).json()).toMatchObject([{ id: 'a', result: { method: 'tools/list' } }])
    expect((await fetch(url, { method: 'DELETE', headers: { 'mcp-session-id': session } })).status).toBe(200)
    expect((await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, session)).status).toBe(404)
  })

  it('wants an initialize to open a bridged session', async () => {
    const url = await start({ entry: { command: 'node', args: ['-e', ECHO] }, npm: null, env: {} })
    expect((await post(url, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(400)
  })

  it('proxies a remote server with the headers of its entry', async () => {
    let seen: Record<string, unknown> = {}
    upstream = createServer((req, res) => {
      seen = req.headers
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'up-1' }).end('{"ok":true}')
    })
    await new Promise<void>((resolve) => upstream!.listen(0, '127.0.0.1', resolve))
    const address = upstream.address() as { port: number }
    const url = await start({ entry: { type: 'http', url: `http://127.0.0.1:${address.port}/mcp`, headers: { Authorization: 'Bearer t' } }, npm: null, env: {} })
    const response = await post(url, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(response.headers.get('mcp-session-id')).toBe('up-1')
    expect(await response.json()).toEqual({ ok: true })
    expect(seen.authorization).toBe('Bearer t')
  })

  it('answers 404 to a route it does not know', async () => {
    const url = await start(null)
    expect((await post(url, {})).status).toBe(404)
    expect((await post(`${gateway!.origin}/other`, {})).status).toBe(404)
  })
})
