import { execFile } from 'node:child_process'
import { pathKey } from '../paths.js'

/** How long a call given up on may still run before it is killed. */
const KILL_AFTER_MS = 5 * 60_000

export interface CallOptions {
  cwd?: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  maxBuffer?: number
  /** Waits only for the running call and earlier priority ones, not for the ordinary calls queued before it. */
  priority?: boolean
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
 * the folder never starts. A priority call (`/usage`, BTN-635) goes ahead of the waiting ordinary calls, never ahead of
 * the running one.
 */
export class FolderCalls {
  private readonly folders = new Map<string, Folder>()

  constructor(private readonly killAfterMs = KILL_AFTER_MS) {}

  run(folder: string, file: string, args: string[], { cwd, env, timeoutMs, maxBuffer, priority = false }: CallOptions): Promise<CallOutput> {
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        settled = true
        reject(new CallTimeout(file, args))
      }, timeoutMs)
      const start = () =>
        new Promise<void>((ended) => {
          if (settled) return ended()
          let kill: NodeJS.Timeout | undefined
          try {
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
            kill = setTimeout(() => child.kill(), this.killAfterMs)
          } catch (error) {
            ended()
            settled = true
            clearTimeout(timer)
            reject(error as Error)
          }
        })
      this.enqueue(pathKey(folder), { priority, start })
    })
  }

  private enqueue(key: string, call: Waiting): void {
    let folder = this.folders.get(key)
    if (folder === undefined) {
      folder = { running: false, waiting: [] }
      this.folders.set(key, folder)
    }
    const at = call.priority ? folder.waiting.findIndex((other) => !other.priority) : -1
    folder.waiting.splice(at === -1 ? folder.waiting.length : at, 0, call)
    this.next(key, folder)
  }

  private next(key: string, folder: Folder): void {
    if (folder.running) return
    const call = folder.waiting.shift()
    if (call === undefined) {
      this.folders.delete(key)
      return
    }
    folder.running = true
    void call.start().then(() => {
      folder.running = false
      this.next(key, folder)
    })
  }
}

interface Waiting {
  priority: boolean
  /** Runs the call, or skips it if its caller gave up; resolves once the folder is free again. */
  start: () => Promise<void>
}

interface Folder {
  running: boolean
  waiting: Waiting[]
}
