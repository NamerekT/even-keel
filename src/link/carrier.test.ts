import { X509Certificate } from 'node:crypto'
import { request, type IncomingMessage } from 'node:http'
import type { Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createCertificate, type HubCertificate } from './cert.js'
import { HubEnd } from './hub.js'
import { createHubServer } from './hub-server.js'
import { MemoryHubStore, MemoryMachineStore } from './link.fixture.js'
import { MachineEnd } from './machine.js'
import { connectPinned, frameReader, httpsTransport, joinHub } from './machine-transport.js'
import {
  API_VERSION, EVENTS_PATH, JOIN_PATH, STREAM_PATH, bearerOf, isRefusal, parseToken,
  type ConnectionToken, type Frame, type MachineAbout, type MachineEvent, type NumberedCommand,
} from './protocol.js'

const ABOUT: MachineAbout = {
  host: 'example-laptop', os: 'linux 6.8.0', evenKeel: '0.4.0', node: '24.11.0', git: '2.47.0', agents: { claude: '2.1.0' }, gitUser: false, root: null,
}

const until = async (holds: () => boolean, what: string) => {
  for (let waited = 0; !holds(); waited += 10) {
    if (waited > 10_000) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe("the hub's certificate", () => {
  it('is a self-signed certificate Node reads, named by the SHA-256 of its bytes', () => {
    const made = createCertificate(new Date('2026-11-15T00:00:00Z'))
    const read = new X509Certificate(made.cert)
    expect(read.subject).toBe('CN=Even Keel hub')
    expect(read.issuer).toBe(read.subject)
    expect(read.verify(read.publicKey)).toBe(true)
    expect(read.fingerprint256.replaceAll(':', '').toLowerCase()).toBe(made.fingerprint)
    expect(new Date(read.validFrom).toISOString()).toBe('2026-11-14T00:00:00.000Z')
    expect(new Date(read.validTo).toISOString()).toBe('2051-11-15T00:00:00.000Z')
    expect(made.key).toContain('BEGIN PRIVATE KEY')
    expect(createCertificate().fingerprint).not.toBe(made.fingerprint)
  })
})

describe('the stream of frames', () => {
  it('reads frames that come in pieces and several at once, and passes over comments', () => {
    const frames: Frame[] = []
    const read = frameReader((frame) => frames.push(frame))
    read('event: ping\ndata: {"kin')
    read('d":"ping"}\n\n: a comment\n\nevent: command\r\ndata: {"kind":"command","command":{"seq":1,"type":"example.run"}}\r\n\r\nevent: pi')
    expect(frames).toEqual([{ kind: 'ping' }, { kind: 'command', command: { seq: 1, type: 'example.run' } }])
    read('ng\ndata: not json\n\n')
    expect(frames).toHaveLength(2)
  })
})

describe('the link over HTTPS', { timeout: 30_000 }, () => {
  let server: Server | undefined
  let hub: HubEnd | undefined
  const machines: MachineEnd[] = []

  afterEach(async () => {
    for (const machine of machines.splice(0)) machine.stop()
    hub?.stop()
    server?.closeAllConnections()
    await new Promise((resolve) => (server === undefined ? resolve(undefined) : server.close(resolve)))
    server = undefined
  })

  const started = async (heartbeatMs = 20_000) => {
    const certificate: HubCertificate = createCertificate()
    const log: string[] = []
    const taken: MachineEvent[] = []
    const snapshots: unknown[] = []
    const requests: string[] = []
    hub = new HubEnd({
      store: new MemoryHubStore(),
      heartbeatMs,
      log: (line) => log.push(line),
      handlers: { event: (_machine, event) => void taken.push(event), snapshot: (_machine, snapshot) => void snapshots.push(snapshot) },
    })
    server = createHubServer({ hub, certificate, log: (line) => log.push(line), maxBodyBytes: 4_096 })
    server.on('request', (incoming: IncomingMessage) => requests.push(incoming.url ?? ''))
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = `https://127.0.0.1:${(server.address() as AddressInfo).port}`
    const token = parseToken(await hub.issue('Example server', address, certificate.fingerprint))!
    const ran: NumberedCommand[] = []
    const machine = (with_: ConnectionToken = token, api?: number) => {
      const end = new MachineEnd({
        transport: httpsTransport(with_, { log: (line) => log.push(line), timeoutMs: 5_000 }),
        store: new MemoryMachineStore(),
        host: 'example-host',
        snapshot: () => ({ sessions: ['example'] }),
        command: (command) => void ran.push(command),
        log: (line) => log.push(line),
        ...(api === undefined ? {} : { api }),
      })
      machines.push(end)
      return end
    }
    /** A raw POST over a pinned connection: the answer's status, headers and what came of the body so far. */
    const raw = async (path: string, body: string, method = 'POST', authorization = bearerOf(token)) => {
      const socket = await connectPinned(token)
      return new Promise<{ status: number; headers: IncomingMessage['headers']; text: () => string; close: () => void }>((resolve, reject) => {
        const sent = request({ createConnection: () => socket, method, path, headers: { Host: '127.0.0.1', Authorization: authorization, 'Content-Length': Buffer.byteLength(body) } })
        sent.once('error', reject)
        sent.once('response', (response) => {
          let text = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => { text += chunk })
          resolve({ status: response.statusCode ?? 0, headers: response.headers, text: () => text, close: () => socket.destroy() })
        })
        sent.end(body)
      })
    }
    return { hub, token, certificate, log, taken, snapshots, ran, requests, machine, raw }
  }

  it('carries the handshake, a command down and an event up', async () => {
    const made = await started(100)
    const machine = made.machine()
    await machine.start()
    await until(() => machine.status().state === 'online', 'the machine online')
    expect(made.snapshots).toEqual([{ sessions: ['example'] }])
    await made.hub.send(made.token.machine, { type: 'example.run', payload: { text: 'привет' } })
    await until(() => made.ran.length === 1, 'the command')
    expect(made.ran).toEqual([{ seq: 1, type: 'example.run', payload: { text: 'привет' } }])
    await machine.emit('example.done', { task: 'ABC-1' })
    await until(() => made.taken.length === 1, 'the event')
    expect(made.taken[0]).toMatchObject({ seq: 1, type: 'example.done', payload: { task: 'ABC-1' } })
    // Several pulses both ways leave the one connection in place.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(made.requests.filter((path) => path === STREAM_PATH)).toHaveLength(1)
    expect(machine.status()).toEqual({ state: 'online' })
  })

  it('answers the stream with the headers that keep a proxy from holding it, each frame at once', async () => {
    const made = await started()
    const answer = await made.raw(STREAM_PATH, JSON.stringify({ api: API_VERSION, host: 'example-host', lastCommand: 0 }))
    expect(answer.status).toBe(200)
    expect(answer.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(answer.headers['cache-control']).toBe('no-cache, no-transform')
    expect(answer.headers['x-accel-buffering']).toBe('no')
    await until(() => answer.text().includes('\n\n'), 'the handshake frame')
    expect(answer.text().startsWith(`event: hello\ndata: {"kind":"hello","hello":{"api":${API_VERSION},`)).toBe(true)
    await made.hub.send(made.token.machine, { type: 'example.run' })
    await until(() => answer.text().includes('event: command'), 'the command frame')
    answer.close()
    await until(() => !made.hub.connected(made.token.machine), 'the hub to see the stream closed')
  })

  it('sends nothing to a server with another certificate', async () => {
    const made = await started()
    const other = { ...made.token, fingerprint: 'ab'.repeat(32) }
    await expect(connectPinned(other)).rejects.toThrow('is not the one of this machine')
    const machine = made.machine(other)
    await machine.start()
    await until(() => made.log.some((line) => line.includes('is not the one of this machine')), 'the refusal in the log')
    expect(machine.status().state).not.toBe('online')
    expect(made.requests).toEqual([])
  })

  it('does not take a self-signed certificate when the token names no fingerprint', async () => {
    const made = await started()
    await expect(connectPinned({ ...made.token, fingerprint: '' })).rejects.toThrow()
    expect(made.requests).toEqual([])
  })

  it('turns away a wrong secret and another API version with their notices', async () => {
    const made = await started()
    const stranger = made.machine({ ...made.token, secret: 'wrong' })
    await stranger.start()
    await until(() => stranger.status().notice === 'link.token', 'the token notice')
    const newer = made.machine(made.token, API_VERSION + 1)
    await newer.start()
    await until(() => newer.status().notice === 'link.version', 'the version notice')
    const hello = JSON.stringify({ api: API_VERSION, host: 'example-host', lastCommand: 0 })
    expect((await made.raw(STREAM_PATH, hello, 'POST', 'Bearer none.none')).status).toBe(401)
    expect((await made.raw(STREAM_PATH, JSON.stringify({ api: 7, host: 'example-host', lastCommand: 0 }))).status).toBe(426)
    expect((await made.raw(EVENTS_PATH, JSON.stringify({ connection: 'gone', events: [], lastCommand: 0 }))).status).toBe(409)
  })

  it('refuses what is not a request of a machine', async () => {
    const made = await started()
    expect((await made.raw(STREAM_PATH, 'not json')).status).toBe(400)
    expect((await made.raw(STREAM_PATH, '{"api":"1"}')).status).toBe(400)
    expect((await made.raw(EVENTS_PATH, '{"connection":"c","lastCommand":0,"events":[{"seq":"1"}]}')).status).toBe(400)
    expect((await made.raw(STREAM_PATH, '', 'GET')).status).toBe(405)
    expect((await made.raw('/api/state', '{}')).status).toBe(404)
    expect((await made.raw(EVENTS_PATH, JSON.stringify({ connection: 'c', lastCommand: 0, events: [], filler: 'x'.repeat(5_000) }))).status).toBe(413)
    expect((await made.raw(JOIN_PATH, JSON.stringify({ api: API_VERSION }))).status).toBe(400)
    expect(made.log).toEqual([])
  })

  it('exchanges a connection string for the machine its own secret, and the string works no more', async () => {
    const made = await started()
    const invite = await made.hub.invite('Example laptop', made.token.hub, made.certificate.fingerprint)
    const string = parseToken(invite.line)!
    const joined = await joinHub(string, ABOUT, 5_000)
    if (isRefusal(joined)) throw new Error(`refused: ${joined.refused}`)
    expect(joined).toMatchObject({ hub: string.hub, fingerprint: string.fingerprint, machine: string.machine })
    expect(joined.secret).not.toBe(string.secret)
    expect(await joinHub(string, ABOUT, 5_000)).toEqual({ refused: 'used' })
    expect((await made.raw(JOIN_PATH, JSON.stringify({ api: API_VERSION, about: ABOUT }), 'POST', bearerOf(string))).status).toBe(410)
    const machine = made.machine(joined)
    await machine.start()
    await until(() => machine.status().state === 'online', 'the joined machine online')
  })
})
