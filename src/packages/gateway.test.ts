import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createServer, type Server } from 'node:http'
import { connect } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpGateway, refusal, shellQuoted, stopProcess, type GatewayTarget } from './gateway.js'
import { routeOf } from './launch.js'

const ECHO = `
const lines = require('node:readline').createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { method: message.method, key: process.env.KEY ?? null } }) + '\\n')
})
`

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('shellQuoted', () => {
  it('keeps a plain argument and quotes one with a space or a shell character', () => {
    expect(shellQuoted('src/server.py')).toBe('src/server.py')
    expect(shellQuoted('C:\\Users\\John\\Claude Extensions\\paperless')).toBe('"C:\\Users\\John\\Claude Extensions\\paperless"')
    expect(shellQuoted('a&b')).toBe('"a&b"')
    expect(shellQuoted('')).toBe('""')
  })

  it('escapes quotes and the backslashes before them and at the end', () => {
    expect(shellQuoted('say "hi"')).toBe('"say \\"hi\\""')
    expect(shellQuoted('C:\\dir with space\\')).toBe('"C:\\dir with space\\\\"')
  })
})

describe('stopProcess', () => {
  const fake = () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null as string | null, pid: 1, kill: vi.fn(() => true) })
    const exit = (signal: string) => {
      child.signalCode = signal
      child.emit('exit', null, signal)
    }
    return { child, exit, process: child as unknown as ChildProcess }
  }

  afterEach(() => void vi.useRealTimers())

  it('sends SIGTERM and resolves only once the process exits', async () => {
    const { child, exit, process } = fake()
    let done = false
    const stopped = stopProcess(process, 5000).then(() => (done = true))
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(done).toBe(false)
    exit('SIGTERM')
    await stopped
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('kills a process that ignores SIGTERM once the grace runs out', async () => {
    vi.useFakeTimers()
    const { child, exit, process } = fake()
    const stopped = stopProcess(process, 5000)
    await vi.advanceTimersByTimeAsync(4999)
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL')
    await vi.advanceTimersByTimeAsync(1)
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL')
    exit('SIGKILL')
    await stopped
  })

  it('does not hang on a process that outlives SIGKILL', async () => {
    vi.useFakeTimers()
    const { process } = fake()
    const stopped = stopProcess(process, 5000).then(() => 'stopped')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await stopped).toBe('stopped')
  })

  it('resolves at once for a process already gone', async () => {
    const { child, process } = fake()
    child.exitCode = 0
    await stopProcess(process, 5000)
    expect(child.kill).not.toHaveBeenCalled()
  })
})

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

  it('kills a shared server on close and does not wait for a connection still open (BTN-720)', async () => {
    const shared = `
require('node:http').createServer((req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { pid: process.pid } })))
  .listen(Number(process.env.MCP_HTTP_PORT), '127.0.0.1')
`
    gateway = new McpGateway({ resolve: () => ({ entry: { command: 'node', args: ['-e', shared] }, npm: '@firfi/huly-mcp', env: {} }), baseEnv: () => ({ PATH: process.env.PATH }), log: () => {} })
    await gateway.listen(0)
    const url = `${gateway.origin}${routeOf('p-1', 'huly', 'i1', 'huly')}`
    const reply = (await (await post(url, { jsonrpc: '2.0', id: 0, method: 'initialize' })).json()) as { result: { pid: number } }
    const socket = connect(Number(new URL(gateway.origin).port), '127.0.0.1')
    await new Promise((resolve) => socket.once('connect', resolve))
    socket.write('POST /half HTTP/1.1\r\nHost: 127.0.0.1\r\n')
    await new Promise((resolve) => setTimeout(resolve, 50))
    const closed = gateway.close().then(() => 'closed')
    expect(await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve('hangs'), 2000))])).toBe('closed')
    socket.destroy()
    gateway = undefined
    // The close waits for the exit: systemd must not find the server alive once node is gone (BTN-723).
    expect(alive(reply.result.pid)).toBe(false)
  })

  it('waits on close for a bridged server to exit', async () => {
    const pid = `
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(line).id, result: { pid: process.pid } }) + '\\n')
})
`
    const url = await start({ entry: { command: 'node', args: ['-e', pid] }, npm: null, env: {} })
    const reply = (await (await post(url, { jsonrpc: '2.0', id: 1, method: 'initialize' })).json()) as { result: { pid: number } }
    await gateway!.close()
    gateway = undefined
    expect(alive(reply.result.pid)).toBe(false)
  })

  it('holds the first request of a shared server until it answers HTTP, not only until its port accepts', async () => {
    // huly-mcp listens before it attaches its handler: a request in between is never answered.
    const late = `
const server = require('node:http').createServer()
server.listen(Number(process.env.MCP_HTTP_PORT), '127.0.0.1', () => setTimeout(() => server.on('request', (req, res) => {
  const ok = req.headers.authorization === 'Bearer ' + process.env.MCP_AUTH_TOKEN
  res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' }).end('{"jsonrpc":"2.0","id":0,"result":{}}')
}), 300))
`
    const lines: string[] = []
    gateway = new McpGateway({ resolve: () => ({ entry: { command: 'node', args: ['-e', late] }, npm: '@firfi/huly-mcp', env: {} }), baseEnv: () => ({ PATH: process.env.PATH }), log: (line) => lines.push(line) })
    await gateway.listen(0)
    const url = `${gateway.origin}${routeOf('p-1', 'huly', 'i1', 'huly')}`
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":0,"method":"initialize"}', signal: AbortSignal.timeout(3000) })
    expect(response.status).toBe(200)
    expect(lines).toEqual([expect.stringMatching(/^mcp gateway: huly\/huly started in \d+ s$/)])
  })

  it('uses profile OAuth, retries a 401 once and never forwards the old Basic header', async () => {
    const seen: string[] = []
    upstream = createServer((req, res) => {
      seen.push(req.headers.authorization ?? '')
      res.writeHead(seen.length === 1 ? 401 : 200, { 'content-type': 'application/json' }).end('{}')
    })
    await new Promise<void>((resolve) => upstream!.listen(0, '127.0.0.1', resolve))
    const port = (upstream.address() as { port: number }).port
    const token = vi.fn(async (rejected?: string) => rejected === undefined ? 'old' : 'new')
    const url = await start({ entry: { url: `http://127.0.0.1:${port}`, headers: { Authorization: 'Basic private' } }, npm: null, env: {}, oauth: { token, refused: vi.fn() } })
    expect((await post(url, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(200)
    expect(seen).toEqual(['Bearer old', 'Bearer new'])
    expect(token).toHaveBeenLastCalledWith('old')
  })

  it('logs a server error when it starts or changes and when the server works again, not on every request (BTN-589)', async () => {
    upstream = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{}'))
    await new Promise<void>((resolve) => upstream!.listen(0, '127.0.0.1', resolve))
    const port = (upstream.address() as { port: number }).port
    let failure: Error | null = new Error('MCP access was revoked')
    const token = vi.fn(async () => {
      if (failure !== null) throw failure
      return 'access'
    })
    const lines: string[] = []
    gateway = new McpGateway({ resolve: () => ({ entry: { url: `http://127.0.0.1:${port}` }, npm: null, env: {}, oauth: { token, refused: vi.fn() } }), baseEnv: () => ({}), log: (line) => lines.push(line) })
    await gateway.listen(0)
    const url = `${gateway.origin}${routeOf('p-1', 'jira', 'i1', 'jira')}`
    const ask = async () => (await post(url, { jsonrpc: '2.0', id: 1, method: 'initialize' })).status
    expect([await ask(), await ask()]).toEqual([502, 502])
    failure = new Error('MCP OAuth did not complete')
    expect([await ask(), await ask()]).toEqual([502, 502])
    failure = null
    expect([await ask(), await ask()]).toEqual([200, 200])
    expect(lines).toEqual([
      'mcp gateway: jira/jira: MCP access was revoked',
      'mcp gateway: jira/jira: MCP OAuth did not complete',
      'mcp gateway: jira/jira works again',
    ])
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

  it('says in the log which request a server left unanswered when the client gave up on it', async () => {
    upstream = createServer(() => {})
    await new Promise<void>((resolve) => upstream!.listen(0, '127.0.0.1', resolve))
    const address = upstream.address() as { port: number }
    const lines: string[] = []
    gateway = new McpGateway({ resolve: () => ({ entry: { type: 'http', url: `http://127.0.0.1:${address.port}/mcp` }, npm: null, env: {} }), baseEnv: () => ({}), log: (line) => lines.push(line) })
    await gateway.listen(0)
    const url = `${gateway.origin}${routeOf('p-1', 'echo', 'i1', 'echo')}`
    const body = JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize' })
    await expect(fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(100) })).rejects.toThrow()
    await vi.waitFor(() => expect(lines).toEqual(['mcp gateway: echo/echo did not answer initialize in 0 s']))
    upstream.closeAllConnections()
  })

  it('answers a deleting call of a protected tracker itself and lets the other calls through', async () => {
    const seen: string[] = []
    upstream = createServer((req, res) => {
      let text = ''
      req.on('data', (chunk) => (text += chunk))
      req.on('end', () => {
        seen.push(text)
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"jsonrpc":"2.0","id":2,"result":{}}')
      })
    })
    await new Promise<void>((resolve) => upstream!.listen(0, '127.0.0.1', resolve))
    const port = (upstream.address() as { port: number }).port
    const url = await start({ entry: { type: 'http', url: `http://127.0.0.1:${port}/mcp` }, npm: null, env: {}, refuseDeletes: 'GitLab' })
    const refused = await post(url, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delete_issue', arguments: { issue_iid: 3 } } })
    expect(await refused.json()).toMatchObject({ id: 1, result: { isError: true, content: [{ type: 'text', text: expect.stringContaining('deleting GitLab records') }] } })
    const batch = await post(url, [{ jsonrpc: '2.0', id: 'a', method: 'tools/list' }, { jsonrpc: '2.0', id: 'b', method: 'tools/call', params: { name: 'label_write', arguments: { method: 'delete' } } }])
    expect(await batch.json()).toMatchObject([{ id: 'a', error: { code: -32600 } }, { id: 'b', result: { isError: true } }])
    const nested = await post(url, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'invoke_tool', arguments: { toolName: 'delete_comment', arguments: { commentId: 'c1' } } } })
    expect(await nested.json()).toMatchObject({ id: 3, result: { isError: true } })
    const nestedMethod = await post(url, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'invoke_tool', arguments: { toolName: 'label_write', arguments: { method: 'delete' } } } })
    expect(await nestedMethod.json()).toMatchObject({ id: 4, result: { isError: true } })
    expect(seen).toEqual([])
    expect((await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'update_issue', arguments: {} } })).status).toBe(200)
    expect(seen).toHaveLength(1)
  })

  it('lets a deleting call through when Protection is off for the server', async () => {
    const url = await start({ entry: { command: 'node', args: ['-e', ECHO] }, npm: null, env: {} })
    const session = (await post(url, { jsonrpc: '2.0', id: 1, method: 'initialize' })).headers.get('mcp-session-id')!
    expect(await (await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'delete_issue' } }, session)).json()).toMatchObject({ result: { method: 'tools/call' } })
  })

  it('answers 404 to a route it does not know', async () => {
    const url = await start(null)
    expect((await post(url, {})).status).toBe(404)
    expect((await post(`${gateway!.origin}/other`, {})).status).toBe(404)
  })
})
