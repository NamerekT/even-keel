import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Kills a detached turn with its children: on Windows a shell wrapper dies alone and leaves the agent running. */
export async function killTree(pid: number): Promise<void> {
  try {
    if (process.platform === 'win32') await run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    else process.kill(-pid, 'SIGTERM')
  } catch {
    if (process.platform !== 'win32') {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // already gone
      }
    }
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
