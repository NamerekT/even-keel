import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)
const QUERY_TIMEOUT_MS = 5_000
export const APPEAR_TIMEOUT_MS = 60_000

export function turnStartedAt(out: string): number | undefined {
  const match = /-(\d+)\.jsonl$/.exec(out)
  return match === null ? undefined : finite(Number(match[1]))
}

/** A younger process has reused the turn's pid; unknown times preserve the existing stop behaviour. */
export function processBelongsToTurn(startedAt: number | undefined, turnAt: number | undefined): boolean {
  return startedAt === undefined || turnAt === undefined || startedAt <= turnAt + APPEAR_TIMEOUT_MS
}

/** Queried only before a stop, never by the session poller. */
export async function processStartedAt(pid: number): Promise<number | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  try {
    const options = { timeout: QUERY_TIMEOUT_MS, windowsHide: true }
    if (process.platform === 'win32') {
      const command = `([DateTimeOffset](Get-Process -Id ${pid} -ErrorAction Stop).StartTime).ToUnixTimeMilliseconds()`
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], options)
      return stdout.trim() === '' ? undefined : finite(Number(stdout.trim()))
    }
    if (process.platform === 'linux') {
      const [stat, boot, { stdout }] = await Promise.all([
        readFile(`/proc/${pid}/stat`, 'utf8'),
        readFile('/proc/stat', 'utf8'),
        run('getconf', ['CLK_TCK'], options),
      ])
      // Field 22 follows a parenthesised command name which may itself contain spaces or parentheses.
      const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[19])
      const bootSeconds = /^btime (\d+)$/m.exec(boot)?.[1]
      const frequency = Number(stdout.trim())
      if (bootSeconds === undefined || frequency <= 0) return undefined
      return finite((Number(bootSeconds) + ticks / frequency) * 1_000)
    }
    if (process.platform === 'darwin') {
      const { stdout } = await run('ps', ['-o', 'lstart=', '-p', String(pid)], { ...options, env: { ...process.env, LC_ALL: 'C' } })
      return finite(Date.parse(stdout.trim()))
    }
  } catch {
    // A missing process or an unavailable start time keeps the existing stop behaviour.
  }
  return undefined
}

function finite(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined
}
