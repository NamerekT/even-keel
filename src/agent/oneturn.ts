import { execFile, spawn } from 'node:child_process'

export interface InputRun {
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
}

/**
 * Runs an agent's CLI with `input` on its stdin and gives its stdout. A prompt goes on stdin rather than as an argument:
 * a milestone's tasks can be longer than a Windows command line (32 767 characters). Past `timeoutMs` the process tree
 * is killed and the call fails.
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
      reject(new Error(timedOut ? `timed out after ${timeoutMs} ms` : `exited with ${code}${tail === '' ? '' : `: ${tail}`}`))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
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
