/**
 * The executor of an SDK session (BTN-239): a detached process that holds the session's `claude` process and outlives
 * the service, so that a restart of Even Keel neither kills a turn nor loses a pending question. The service is its
 * host: it connects over a named pipe (a Unix socket elsewhere) and is the CLI's stdin and stdout for the SDK.
 *
 * Node runs this file alone, by its own type stripping and without tsx (whose esbuild child would hold
 * `node_modules` against `npm ci` for as long as the session lives): it imports only `node:*` and uses only syntax
 * that strips away. Newline-delimited JSON both ways:
 * - host → executor: the first line `{"executor":"spawn",command,args,cwd,env}` or `{"executor":"attach"}`; every other
 *   line goes to the CLI's stdin. Nothing ends that stdin: a host that goes away leaves the CLI running.
 * - executor → host: the first line `{"executor":"hello",pid,turn}`, then the CLI's stdout, and `{"executor":"exit",code}`
 *   once the CLI is gone. What the CLI writes while no host is connected waits for the next one, past a bound in a file.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { createInterface } from 'node:readline'

/** Whether a turn runs, as the executor can tell from the lines it passes on. */
export type ExecutorTurn = 'busy' | 'idle'

export interface ExecutorHello {
  executor: 'hello'
  /** The CLI's process; `null` — it has exited (its `exit` line follows). */
  pid: number | null
  turn: ExecutorTurn
}

const MEMORY_BYTES = 1024 * 1024
const SPILL_BYTES = 256 * 1024 * 1024
const LOG_BYTES = 10 * 1024 * 1024
/** How long an executor nobody connected to waits for its first host. */
const FIRST_HOST_MS = 60_000
/** How long the executor of a CLI that has exited waits for a host to take its last lines. */
const LAST_HOST_MS = 10 * 60_000

/** A user message going in starts a turn, an assistant message coming out means one runs, a result ends it. */
export function turnAfter(turn: ExecutorTurn, line: string, from: 'host' | 'cli'): ExecutorTurn {
  const type = typeOf(line)
  if (from === 'host') return type === 'user' ? 'busy' : turn
  if (type === 'assistant') return 'busy'
  if (type === 'result') return 'idle'
  return turn
}

function typeOf(line: string): string | undefined {
  if (!line.startsWith('{')) return undefined
  try {
    const type = (JSON.parse(line) as { type?: unknown }).type
    return typeof type === 'string' ? type : undefined
  } catch {
    return undefined
  }
}

/** The lines the CLI wrote while no host was connected: in memory up to a bound, then all in the spill file. */
export class Backlog {
  private lines: string[] = []
  private bytes = 0
  private spilled = 0
  private readonly file: string
  private readonly memoryBytes: number
  private readonly spillBytes: number

  // No parameter properties: Node's type stripping does not take them.
  constructor(file: string, memoryBytes = MEMORY_BYTES, spillBytes = SPILL_BYTES) {
    this.file = file
    this.memoryBytes = memoryBytes
    this.spillBytes = spillBytes
  }

  push(line: string): void {
    if (this.spilled > 0 || this.bytes + line.length > this.memoryBytes) {
      this.spill([...this.lines, line])
      this.lines = []
      this.bytes = 0
      return
    }
    this.lines.push(line)
    this.bytes += line.length
  }

  /** Every line, oldest first; the backlog is empty afterwards. */
  drain(): string[] {
    const spilled = this.spilled > 0 ? readFileSync(this.file, 'utf8').split('\n').slice(0, -1) : []
    const lines = [...spilled, ...this.lines]
    this.clear()
    return lines
  }

  clear(): void {
    if (this.spilled > 0) rmSync(this.file, { force: true })
    this.spilled = 0
    this.lines = []
    this.bytes = 0
  }

  /** Past the file's bound the lines are dropped: a pending question is asked again when the next host connects. */
  private spill(lines: string[]): void {
    const text = lines.map((line) => `${line}\n`).join('')
    if (this.spilled + text.length > this.spillBytes) return
    appendFileSync(this.file, text)
    this.spilled += text.length
  }
}

interface Spawn {
  executor: 'spawn'
  command: string
  args: string[]
  cwd?: string
  env: Record<string, string | undefined>
}

function main(pipe: string, logFile: string, spillFile: string): void {
  const backlog = new Backlog(spillFile)
  let child: ChildProcess | undefined
  let exitCode: number | null | undefined
  let host: Socket | undefined
  let turn: ExecutorTurn = 'idle'
  let leaving: NodeJS.Timeout | undefined

  const log = (line: string) => {
    try {
      if ((statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > LOG_BYTES) return
      appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`)
    } catch {
      // the log is best effort
    }
  }
  const leaveIn = (ms: number) => {
    clearTimeout(leaving)
    leaving = setTimeout(() => {
      log('no host came, leaving')
      backlog.clear()
      process.exit(0)
    }, ms)
  }
  const toHost = (line: string) => {
    if (host !== undefined && !host.destroyed) host.write(`${line}\n`)
    else backlog.push(line)
  }

  const start = ({ command, args, cwd, env }: Spawn) => {
    const cli = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    child = cli
    log(`spawned the CLI ${cli.pid ?? '?'}`)
    createInterface({ input: cli.stdout!, crlfDelay: Infinity }).on('line', (line) => {
      turn = turnAfter(turn, line, 'cli')
      toHost(line)
    })
    createInterface({ input: cli.stderr!, crlfDelay: Infinity }).on('line', (line) => log(`stderr: ${line}`))
    cli.stdin!.on('error', (error) => log(`stdin: ${error.message}`))
    cli.on('error', (error) => log(`the CLI failed: ${error.message}`))
    cli.on('exit', (code) => {
      exitCode = code
      log(`the CLI exited with ${String(code)}`)
      toHost(JSON.stringify({ executor: 'exit', code }))
      if (host !== undefined && !host.destroyed) {
        host.end()
        setTimeout(() => process.exit(0), 1_000)
      } else leaveIn(LAST_HOST_MS)
    })
  }

  const server = createServer((socket) => {
    let first = true
    socket.on('error', (error) => log(`host socket: ${error.message}`))
    createInterface({ input: socket, crlfDelay: Infinity }).on('line', (line) => {
      if (!first) {
        if (socket !== host || child === undefined || exitCode !== undefined) return
        turn = turnAfter(turn, line, 'host')
        child.stdin!.write(`${line}\n`)
        return
      }
      first = false
      let hello: Spawn | { executor: 'attach' }
      try {
        hello = JSON.parse(line) as Spawn | { executor: 'attach' }
      } catch {
        socket.destroy()
        return
      }
      if (hello.executor === 'spawn' && child === undefined) start(hello)
      if (child === undefined) {
        socket.destroy()
        return
      }
      if (host !== undefined && host !== socket) host.destroy()
      host = socket
      clearTimeout(leaving)
      log(`a host connected (${hello.executor})`)
      const greeting: ExecutorHello = { executor: 'hello', pid: exitCode === undefined ? (child.pid ?? null) : null, turn }
      socket.write(`${JSON.stringify(greeting)}\n`)
      for (const each of backlog.drain()) socket.write(`${each}\n`)
      if (exitCode !== undefined) {
        socket.end()
        setTimeout(() => process.exit(0), 1_000)
      }
    })
    socket.on('close', () => {
      if (host !== socket) return
      host = undefined
      log('the host went away')
      if (exitCode !== undefined) leaveIn(LAST_HOST_MS)
    })
  })
  server.on('error', (error) => {
    log(`the pipe failed: ${error.message}`)
    process.exit(1)
  })
  if (process.platform !== 'win32') {
    rmSync(pipe, { force: true })
    // A Unix socket outlives the process that listens on it; a named pipe goes with it.
    process.once('exit', () => rmSync(pipe, { force: true }))
  }
  server.listen(pipe, () => log(`listening on ${pipe}, pid ${process.pid}`))
  leaveIn(FIRST_HOST_MS)
}

if (import.meta.main) {
  const [pipe, logFile, spillFile] = process.argv.slice(2)
  if (pipe === undefined || logFile === undefined || spillFile === undefined) process.exit(2)
  main(pipe, logFile, spillFile)
}
