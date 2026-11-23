import { createServer, request, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { McpGateway } from './gateway.js'
import { holdGatewayPort, releaseHeldPort, takeHeldPort } from './held-port.js'

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()))
  const address = probe.address()
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return typeof address === 'object' && address !== null ? address.port : 0
}

function ask(port: number, path = '/'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let body = ''
      res.on('data', (chunk: Buffer) => (body += chunk.toString()))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end('{"ping":1}')
  })
}

const servers: Server[] = []
let gateway: McpGateway | undefined

afterEach(async () => {
  await releaseHeldPort()
  await gateway?.close()
  gateway = undefined
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe('the gateway port held from the start (BTN-1544)', () => {
  it('accepts a request before the gateway is ready and hands it over with its body', async () => {
    const port = await freePort()
    holdGatewayPort(port)
    const answer = ask(port)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const server = await takeHeldPort(port, (req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => (body += chunk.toString()))
      req.on('end', () => res.writeHead(200).end(`late ${body}`))
    })
    expect(server).toBeDefined()
    servers.push(server!)
    await expect(answer).resolves.toEqual({ status: 200, body: 'late {"ping":1}' })
    await expect(ask(port)).resolves.toEqual({ status: 200, body: 'late {"ping":1}' })
  })

  it('gives nothing for another port, and the hold stays', async () => {
    const port = await freePort()
    holdGatewayPort(port)
    await expect(takeHeldPort(port + 1, () => {})).resolves.toBeUndefined()
    await expect(takeHeldPort(0, () => {})).resolves.toBeUndefined()
    const server = await takeHeldPort(port, (_req, res) => res.writeHead(204).end())
    servers.push(server!)
    await expect(ask(port)).resolves.toMatchObject({ status: 204 })
  })

  it('gives nothing when the port was taken, without throwing', async () => {
    const busy = createServer()
    await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', () => resolve()))
    servers.push(busy)
    const address = busy.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    holdGatewayPort(port)
    await expect(takeHeldPort(port, () => {})).resolves.toBeUndefined()
  })

  it('a release answers the waiting requests 503 and frees the port', async () => {
    const port = await freePort()
    holdGatewayPort(port)
    const answer = ask(port)
    await new Promise((resolve) => setTimeout(resolve, 50))
    await releaseHeldPort()
    await expect(answer).resolves.toMatchObject({ status: 503 })
    await expect(takeHeldPort(port, () => {})).resolves.toBeUndefined()
    const again = createServer()
    await new Promise<void>((resolve, reject) => {
      again.once('error', reject)
      again.listen(port, '127.0.0.1', () => resolve())
    })
    servers.push(again)
  })

  it('the gateway listens on the held port and answers what waited', async () => {
    const port = await freePort()
    holdGatewayPort(port)
    const answer = ask(port, '/no-such-route')
    await new Promise((resolve) => setTimeout(resolve, 50))
    gateway = new McpGateway({ resolve: () => null, baseEnv: () => ({}), log: () => {} })
    await gateway.listen(port)
    expect(gateway.origin).toBe(`http://127.0.0.1:${port}`)
    expect((await answer).status).toBe(404)
  })
})
