import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { PassThrough, Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { ExecutorHello } from './executor.js'
import type { SdkSpawnedProcess, SdkSpawnOptions } from './types.js'

// Node strips the types of the source; the npm package has only the compiled one.
const EXECUTOR = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './executor.ts' : './executor.js', import.meta.url))
const LISTEN_TIMEOUT_MS = 10_000
const LISTEN_POLL_MS = 100
const PROBE_TIMEOUT_MS = 2_000

/** A new pipe for an executor: a named pipe on Windows, a socket elsewhere, short enough for the 104 bytes of macOS. */
export function newPipe(): string {
  const id = randomUUID().replace(/-/g, '')
  return process.platform === 'win32' ? `\\\\.\\pipe\\even-keel-sdk-${id}` : join(tmpdir(), `ek-sdk-${id.slice(0, 12)}.sock`)
}

/**
 * Starts the executor detached, so that it outlives the service, with no stdio of the service's; resolves with its pid
 * once its pipe takes connections. Node runs it alone, without the service's loader (`executor.ts`).
 */
export async function startExecutor(pipe: string, files: { log: string; spill: string }): Promise<number> {
  const child = spawn(process.execPath, [EXECUTOR, pipe, files.log, files.spill], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  const pid = child.pid
  if (pid === undefined) throw new Error('the executor did not start')
  const deadline = Date.now() + LISTEN_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await probe(pipe)) return pid
    if (child.exitCode !== null) throw new Error(`the executor exited with ${child.exitCode}, see ${files.log}`)
    await delay(LISTEN_POLL_MS)
  }
  throw new Error(`the executor did not open ${pipe}, see ${files.log}`)
}

/** Whether an executor serves the pipe. A connection that sends no line is not a host to it. */
export function probe(pipe: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(pipe)
    const done = (answer: boolean) => {
      clearTimeout(timer)
      socket.destroy()
      resolve(answer)
    }
    const timer = setTimeout(() => done(false), PROBE_TIMEOUT_MS)
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/** The first line a host sends: the CLI to start, or the one already running. */
export type ExecutorRequest = ({ executor: 'spawn' } & Pick<SdkSpawnOptions, 'command' | 'args' | 'cwd' | 'env'>) | { executor: 'attach' }

/**
 * The CLI process as the SDK sees it, behind the executor's pipe. It never ends the CLI or its stdin: `kill` and the
 * end of stdin only let go of the pipe, so that neither a stopping service nor the SDK's own clean-up ends a turn.
 * Stopping a session is killing its executor (`SdkSessions.stop`).
 */
export class ExecutorProcess extends EventEmitter implements SdkSpawnedProcess {
  readonly stdin: Writable
  readonly stdout = new PassThrough()
  killed = false
  exitCode: number | null = null
  private ended = false
  private readonly socket: Socket

  constructor(pipe: string, request: ExecutorRequest, onHello: (hello: ExecutorHello) => void) {
    super()
    const socket = connect(pipe)
    this.socket = socket
    socket.write(`${JSON.stringify(request)}\n`)
    this.stdin = new Writable({
      write: (chunk: Buffer, _encoding, done) => {
        if (socket.destroyed) done()
        else socket.write(chunk, () => done())
      },
      final: (done) => done(),
    })
    let first = true
    createInterface({ input: socket, crlfDelay: Infinity }).on('line', (line) => {
      if (first) {
        first = false
        const hello = parseHello(line)
        if (hello !== undefined) onHello(hello)
        return
      }
      const exit = exitOf(line)
      if (exit !== undefined) this.end(exit)
      else this.stdout.write(`${line}\n`)
    })
    socket.on('error', (error) => this.emit('error', error))
    socket.on('close', () => this.end(null))
  }

  kill(): boolean {
    this.killed = true
    this.socket.destroy()
    return true
  }

  private end(code: number | null): void {
    if (this.ended) return
    this.ended = true
    this.exitCode = code
    this.stdout.end()
    this.emit('exit', code, null)
  }
}

function parseHello(line: string): ExecutorHello | undefined {
  try {
    const value = JSON.parse(line) as Partial<ExecutorHello>
    return value.executor === 'hello' ? (value as ExecutorHello) : undefined
  } catch {
    return undefined
  }
}

function exitOf(line: string): number | null | undefined {
  if (!line.startsWith('{"executor"')) return undefined
  try {
    const value = JSON.parse(line) as { executor?: unknown; code?: unknown }
    if (value.executor !== 'exit') return undefined
    return typeof value.code === 'number' ? value.code : null
  } catch {
    return undefined
  }
}
