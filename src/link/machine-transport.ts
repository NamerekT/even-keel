import { request, type IncomingMessage } from 'node:http'
import { connect, type TLSSocket } from 'node:tls'
import { fingerprintOf } from './cert.js'
import type { HubTransport, StreamSink } from './machine.js'
import {
  EVENTS_PATH, SNAPSHOT_PATH, STREAM_PATH, bearerOf, isRefusal,
  type ConnectionToken, type EventsAnswer, type Frame, type Refusal,
} from './protocol.js'

export interface TransportOptions {
  log: (line: string) => void
  /** How long a connection attempt and a post may take. */
  timeoutMs?: number
}

const TIMEOUT_MS = 15_000

/**
 * A TLS connection to the token's hub, checked before a byte is written to it, so the secret goes to no other server.
 * With a fingerprint in the token the certificate must be exactly that one and its chain and name are not looked at
 * (it is self-signed); without one the certificate is verified as any HTTPS one.
 */
export function connectPinned(token: Pick<ConnectionToken, 'hub' | 'fingerprint'>, timeoutMs: number = TIMEOUT_MS): Promise<TLSSocket> {
  const url = new URL(token.hub)
  const pinned = token.fingerprint !== ''
  return new Promise((resolve, reject) => {
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 443), rejectUnauthorized: !pinned, ALPNProtocols: ['http/1.1'] })
    const failed = (error: Error) => {
      socket.destroy()
      reject(error)
    }
    socket.setTimeout(timeoutMs, () => failed(new Error(`no connection to ${url.host} in ${timeoutMs} ms`)))
    socket.once('error', failed)
    socket.once('secureConnect', () => {
      const raw = socket.getPeerCertificate().raw as Buffer | undefined
      if (pinned && (raw === undefined || fingerprintOf(raw) !== token.fingerprint)) {
        return failed(new Error(`the certificate of ${url.host} is not the one of this machine's connection token`))
      }
      socket.setTimeout(0)
      socket.removeListener('error', failed)
      resolve(socket)
    })
  })
}

function textOf(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => chunks.push(chunk))
    response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    response.on('error', reject)
  })
}

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** The frames of a server-sent stream as they come: text is fed in pieces, an event ends at an empty line. */
export function frameReader(frame: (frame: Frame) => void): (chunk: string) => void {
  let rest = ''
  return (chunk) => {
    rest += chunk.replace(/\r\n/g, '\n')
    for (let end = rest.indexOf('\n\n'); end !== -1; end = rest.indexOf('\n\n')) {
      const data = rest.slice(0, end).split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      rest = rest.slice(end + 2)
      const value = data === '' ? undefined : parsed(data)
      if (typeof value === 'object' && value !== null && typeof (value as { kind?: unknown }).kind === 'string') frame(value as Frame)
    }
  }
}

/** The link over HTTPS: the stream is one long answer to a POST, each post a request of its own. */
export function httpsTransport(token: ConnectionToken, options: TransportOptions): HubTransport {
  const url = new URL(token.hub)
  const base = url.pathname.replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS

  const send = (socket: TLSSocket, path: string, body: unknown) => {
    const text = JSON.stringify(body)
    const sent = request({
      createConnection: () => socket,
      method: 'POST',
      path: `${base}${path}`,
      headers: {
        Host: url.host,
        Authorization: bearerOf(token),
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(text),
        Accept: path === STREAM_PATH ? 'text/event-stream' : 'application/json',
      },
    })
    sent.end(text)
    return sent
  }

  const post = async (path: string, body: unknown): Promise<EventsAnswer | Refusal> => {
    const socket = await connectPinned(token, timeoutMs)
    try {
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        const sent = send(socket, path, body)
        sent.setTimeout(timeoutMs, () => sent.destroy(new Error(`no answer from the hub in ${timeoutMs} ms`)))
        sent.once('response', resolve)
        sent.once('error', reject)
      })
      const value = parsed(await textOf(response))
      if (isRefusal(value)) return value
      if (response.statusCode === 200 && typeof value === 'object' && value !== null && typeof (value as EventsAnswer).lastEvent === 'number') return value as EventsAnswer
      throw new Error(`the hub answered ${response.statusCode} to ${path}`)
    } finally {
      socket.destroy()
    }
  }

  return {
    open(hello, sink: StreamSink) {
      let socket: TLSSocket | undefined
      let over = false
      const end = (refusal?: Refusal) => {
        if (over) return
        over = true
        socket?.destroy()
        sink.closed(refusal)
      }
      connectPinned(token, timeoutMs).then((connected) => {
        if (over) return void connected.destroy()
        socket = connected
        sink.opened()
        const sent = send(connected, STREAM_PATH, hello)
        sent.once('error', () => end())
        sent.once('response', (response) => {
          if (response.statusCode !== 200) {
            textOf(response).then((text) => {
              const value = parsed(text)
              if (!isRefusal(value)) options.log(`link: the hub answered ${response.statusCode} to the stream`)
              end(isRefusal(value) ? value : undefined)
            }, () => end())
            return
          }
          const read = frameReader((frame) => { if (!over) sink.frame(frame) })
          response.setEncoding('utf8')
          response.on('data', read)
          response.once('end', () => end())
          response.once('close', () => end())
          response.once('error', () => end())
        })
      }, (error: unknown) => {
        if (!over) options.log(`link: ${error instanceof Error ? error.message : String(error)}`)
        end()
      })
      return {
        close: () => {
          over = true
          socket?.destroy()
        },
      }
    },
    events: (body) => post(EVENTS_PATH, body),
    snapshot: (body) => post(SNAPSHOT_PATH, body),
  }
}
