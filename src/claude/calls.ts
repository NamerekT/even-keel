import { execFile } from 'node:child_process'
import { pathKey } from '../paths.js'

/** How long a call given up on may still run before it is killed. */
const KILL_AFTER_MS = 5 * 60_000

export interface CallOptions {
  cwd?: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  maxBuffer?: number
}

export interface CallOutput {
  stdout: string
  stderr: string
}

/** The caller stopped waiting; the call itself was left to finish. */
export class CallTimeout extends Error {
  constructor(file: string, args: string[]) {
    super(`${file} ${args.join(' ')} timed out`)
    this.name = 'CallTimeout'
  }
}

/**
 * The short CLI calls of one account folder, one at a time (EKR-15). Any call may renew the folder's sign-in, and a
 * renewed refresh token is single-use: a call killed after sending the renewal and before writing the answer leaves
 * the folder signed out, and two calls renewing at once may too. So a call past its timeout is given up on, not
 * killed: it holds the folder until it ends, or until `killAfterMs`; a call whose timeout passes while it waits for
 * the folder never starts.
 */
export class FolderCalls {
  private readonly tails = new Map<string, Promise<void>>()

  constructor(private readonly killAfterMs = KILL_AFTER_MS) {}

  run(folder: string, file: string, args: string[], { cwd, env, timeoutMs, maxBuffer }: CallOptions): Promise<CallOutput> {
    const key = pathKey(folder)
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        settled = true
        reject(new CallTimeout(file, args))
      }, timeoutMs)
      const turn = (this.tails.get(key) ?? Promise.resolve()).then(() => {
        if (settled) return
        return new Promise<void>((ended) => {
          const child = execFile(file, args, { cwd, env, maxBuffer, windowsHide: true }, (error, stdout, stderr) => {
            clearTimeout(kill)
            ended()
            if (settled) return
            settled = true
            clearTimeout(timer)
            if (error === null) resolve({ stdout, stderr })
            else reject(Object.assign(error, { stdout, stderr }))
          })
          // An open stdin makes `-p` wait 3 s for input and print a warning.
          child.stdin?.end()
          const kill = setTimeout(() => child.kill(), this.killAfterMs)
        })
      })
      this.tails.set(key, turn)
      void turn.then(() => {
        if (this.tails.get(key) === turn) this.tails.delete(key)
      })
    })
  }
}
