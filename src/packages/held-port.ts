import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http'

/**
 * The MCP gateway's port taken at the very start of the process, before the storage and the service (BTN-1544). A
 * Claude session's CLI gives a bridged server up about 18 s after its stream drops, and a restart is down longer than
 * that when the port opens only once the service is up. Held, the port accepts at once and keeps each request,
 * unanswered and with its body unread, until the gateway takes the port over and answers them.
 *
 * Only `node:http` here: `src/start.ts` loads this before its heavier modules.
 */
interface Hold {
  port: number
  server: Server
  /** Whether the port was taken; a refusal leaves the gateway's own `listen` to report it. */
  bound: Promise<boolean>
  waiting: Array<[IncomingMessage, ServerResponse]>
  handler: RequestListener | undefined
}

let hold: Hold | undefined

/** Takes `port` on 127.0.0.1 and keeps what comes until `takeHeldPort`; a port already taken is not an error. */
export function holdGatewayPort(port: number): void {
  if (hold !== undefined || port === 0) return
  const waiting: Hold['waiting'] = []
  const server = createServer((req, res) => {
    if (held.handler !== undefined) return held.handler(req, res)
    waiting.push([req, res])
    res.on('close', () => {
      const index = waiting.findIndex(([, each]) => each === res)
      if (index >= 0) waiting.splice(index, 1)
    })
  })
  const bound = new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => resolve(true))
  })
  const held: Hold = { port, server, bound, waiting, handler: undefined }
  hold = held
}

/** The held server for `port`, now answering through `handler`, the requests that waited first; `undefined` without such a hold. */
export async function takeHeldPort(port: number, handler: RequestListener): Promise<Server | undefined> {
  const held = hold
  if (held === undefined || held.port !== port || port === 0) return undefined
  hold = undefined
  if (!(await held.bound)) return undefined
  held.handler = handler
  for (const [req, res] of held.waiting.splice(0)) handler(req, res)
  return held.server
}

/** Gives the port back when no gateway will take it (the start is blocked): what waited gets 503. */
export async function releaseHeldPort(): Promise<void> {
  const held = hold
  if (held === undefined) return
  hold = undefined
  if (!(await held.bound)) return
  for (const [, res] of held.waiting.splice(0)) res.writeHead(503).end()
  await new Promise<void>((resolve) => held.server.close(() => resolve()))
}
