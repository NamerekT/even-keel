import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { HookAnswer, HookRequest } from '../link/protocol.js'
import { HookReceiver } from './hook-receiver.js'

interface Reply {
  status: number
  body: string
  type: string | undefined
}

const receivers: HookReceiver[] = []
const blockers: Server[] = []

afterEach(async () => {
  await Promise.all(receivers.splice(0).map((receiver) => receiver.close()))
  await Promise.all(blockers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function started(
  forward: (request: HookRequest) => Promise<HookAnswer | undefined>,
  logs: string[] = [],
  port = 0,
): Promise<{ receiver: HookReceiver; port: number }> {
  const receiver = new HookReceiver({ forward, account: () => ({ folders: ['work'] }), log: (line) => logs.push(line) })
  receivers.push(receiver)
  const address = await receiver.start(port)
  return { receiver, port: address.port }
}

function ask(port: number, method: string, path: string, options: { body?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const sent = httpRequest({ host: '127.0.0.1', port, method, path, headers: options.headers }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () =>
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), type: response.headers['content-type'] }),
      )
    })
    sent.on('error', reject)
    sent.end(options.body)
  })
}

describe('HookReceiver', () => {
  it("carries a hook's route with its body and gives the hub's answer back", async () => {
    const asked: HookRequest[] = []
    const { port } = await started(async (request) => {
      asked.push(request)
      return { status: 201, body: '{"ok":true}' }
    })
    const reply = await ask(port, 'POST', '/api/sessions/s%201/check?turn=2', { body: '{"tool":"Edit"}' })
    expect(asked).toEqual([{ method: 'POST', path: '/api/sessions/s%201/check?turn=2', body: '{"tool":"Edit"}' }])
    expect(reply).toMatchObject({ status: 201, body: '{"ok":true}' })
    expect(reply.type).toContain('application/json')
  })

  it('sends no body for a GET route and answers an empty answer without one', async () => {
    const asked: HookRequest[] = []
    const { port } = await started(async (request) => {
      asked.push(request)
      return { status: 204, body: '' }
    })
    const reply = await ask(port, 'GET', '/api/projects/BTN/calibration')
    expect(asked).toEqual([{ method: 'GET', path: '/api/projects/BTN/calibration' }])
    expect(reply).toMatchObject({ status: 204, body: '' })
  })

  it('answers 503 at once while the hub is not reachable', async () => {
    const { port } = await started(async () => undefined)
    const reply = await ask(port, 'GET', '/api/sessions/s1/checkpoint')
    expect(reply.status).toBe(503)
    expect(JSON.parse(reply.body)).toEqual({ error: 'the hub is not reachable' })
  })

  it('refuses a path that is no route of the hooks and does not carry it', async () => {
    const asked: HookRequest[] = []
    const { port } = await started(async (request) => {
      asked.push(request)
      return { status: 200, body: '{}' }
    })
    expect((await ask(port, 'GET', '/api/config')).status).toBe(404)
    expect((await ask(port, 'GET', '/api/sessions/s1/mail')).status).toBe(404)
    expect(asked).toEqual([])
  })

  it('turns away a request with an Origin or a host that is no loopback', async () => {
    const asked: HookRequest[] = []
    const { port } = await started(async (request) => {
      asked.push(request)
      return { status: 200, body: '{}' }
    })
    expect((await ask(port, 'GET', '/api/sessions/s1/note', { headers: { origin: 'https://example.com' } })).status).toBe(403)
    expect((await ask(port, 'GET', '/api/sessions/s1/note', { headers: { host: 'example.com' } })).status).toBe(403)
    expect((await ask(port, 'GET', '/api/state', { headers: { origin: 'https://example.com' } })).status).toBe(403)
    expect(asked).toEqual([])
  })

  it("answers /api/state with the machine's accounts only", async () => {
    const { port } = await started(async () => ({ status: 200, body: '{"hub":true}' }))
    const reply = await ask(port, 'GET', '/api/state?fresh=1')
    expect(reply.status).toBe(200)
    expect(JSON.parse(reply.body)).toEqual({ account: { folders: ['work'] } })
  })

  it('refuses a body over 1 MiB', async () => {
    const asked: HookRequest[] = []
    const { port } = await started(async (request) => {
      asked.push(request)
      return { status: 200, body: '{}' }
    })
    const reply = await ask(port, 'POST', '/api/sessions/s1/mail', { body: 'x'.repeat(1024 * 1024 + 1) }).catch(() => ({ status: 413 }))
    expect(reply.status).toBe(413)
    expect(asked).toEqual([])
  })

  it('listens on a free port when the given one is taken', async () => {
    const blocker = createServer()
    blockers.push(blocker)
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
    const taken = (blocker.address() as AddressInfo).port
    const logs: string[] = []
    const { receiver, port } = await started(async () => ({ status: 200, body: '{}' }), logs, taken)
    expect(port).not.toBe(taken)
    expect(receiver.address).toEqual({ host: '127.0.0.1', port })
    expect(logs.join('\n')).toContain(`port ${taken} is taken`)
    expect((await ask(port, 'GET', '/api/state')).status).toBe(200)
  })

  it('has no address before it listens', () => {
    const receiver = new HookReceiver({ forward: async () => undefined, account: () => ({}), log: () => {} })
    expect(() => receiver.address).toThrow()
  })
})
