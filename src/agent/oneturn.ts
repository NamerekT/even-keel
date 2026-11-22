import { execFile, spawn } from 'node:child_process'

export interface InputRun {
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
}

/**
 * Runs an agent's CLI with `input` on its stdin and gives its stdout. A prompt goes on stdin rather than as an argument:
 * a milestone's tasks can be longer than a Windows command line (32 767 characters). Past `timeoutMs` the process tree
 * is killed and the call fails. A non-zero exit fails with the whole stdout on the error (`stdoutOf`).
 */
export function runWithInput(bin: string, args: string[], input: string, { cwd, env, timeoutMs }: InputRun): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const stdout = Buffer.concat(out).toString('utf8')
      if (code === 0 && !timedOut) return resolve(stdout)
      const tail = (Buffer.concat(err).toString('utf8').trim() || stdout.trim()).slice(-500)
      const error = new Error(timedOut ? `timed out after ${timeoutMs} ms` : `exited with ${code}${tail === '' ? '' : `: ${tail}`}`)
      reject(timedOut ? error : Object.assign(error, { stdout }))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

/** What a run that exited with an error printed; `null` — another failure. */
export function stdoutOf(error: unknown): string | null {
  const stdout = (error as { stdout?: unknown } | null)?.stdout
  return typeof stdout === 'string' ? stdout : null
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
}
