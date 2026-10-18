import { spawn } from 'node:child_process'

const CALL_TIMEOUT_MS = 60_000

export type RpcCall = [method: string, params: Record<string, unknown>]

/**
 * One `codex app-server` session over stdio JSON-RPC: `initialize`, the `initialized` notification, then `calls` one by
 * one; the answers in order. A call answered with an error, an exit or a call left unanswered fails the session.
 */
export async function appServer(bin: string, config: string[], cwd: string, env: NodeJS.ProcessEnv, calls: RpcCall[]): Promise<unknown[]> {
  const child = spawn(bin, [...config, 'app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>()
  let stderr = ''
  let buffer = ''
  let next = 0
  const failAll = (error: Error) => {
    for (const each of pending.values()) each.reject(error)
    pending.clear()
  }
  child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString('utf8')).slice(-2000)))
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end).trim()
      buffer = buffer.slice(end + 1)
      let message: { id?: unknown; method?: unknown; result?: unknown; error?: { message?: unknown } }
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      const waiting = typeof message.id === 'number' && message.method === undefined ? pending.get(message.id) : undefined
      if (waiting === undefined) continue
      pending.delete(message.id as number)
      if (message.error !== undefined) waiting.reject(new Error(String(message.error.message ?? JSON.stringify(message.error))))
      else waiting.resolve(message.result)
    }
  })
  child.on('error', failAll)
  child.on('exit', (code) => failAll(new Error(`codex app-server exited with ${code}: ${stderr.trim()}`)))
  const send = (message: Record<string, unknown>) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  const call = (method: string, params: Record<string, unknown>) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++next
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`codex app-server did not answer ${method}`))
      }, CALL_TIMEOUT_MS)
      pending.set(id, {
        resolve: (result) => (clearTimeout(timer), resolve(result)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      })
      send({ id, method, params })
    })
  try {
    await call('initialize', { clientInfo: { name: 'even-keel', version: '0' } })
    send({ method: 'initialized' })
    const answers: unknown[] = []
    for (const [method, params] of calls) answers.push(await call(method, params))
    return answers
  } finally {
    child.stdin.end()
    child.kill()
  }
}
