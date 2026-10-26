import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)
const QUERY_TIMEOUT_MS = 5_000
export const APPEAR_TIMEOUT_MS = 60_000
const PROCESS_CACHE_MS = 1_000
let windowsSnapshot: { expires: number; query: Promise<Map<number, number>> } | undefined

export function turnStartedAt(out: string): number | undefined {
  const match = /-(\d+)\.jsonl$/.exec(out)
  return match === null ? undefined : finite(Number(match[1]))
}

/** A younger process has reused the turn's pid; unknown times preserve the existing behaviour. */
export function processBelongsToTurn(startedAt: number | undefined, turnAt: number | undefined, appearTimeoutMs = APPEAR_TIMEOUT_MS): boolean {
  return startedAt === undefined || turnAt === undefined || startedAt <= turnAt + appearTimeoutMs
}

/** Polls share one Windows process snapshot, including concurrent polls of different adapters and accounts. */
export async function polledProcessStartedAt(pid: number): Promise<number | undefined> {
  if (process.platform !== 'win32') return processStartedAt(pid)
  if (windowsSnapshot === undefined || Date.now() >= windowsSnapshot.expires) {
    const snapshot = { expires: Infinity, query: windowsProcessTimes() }
    windowsSnapshot = snapshot
    void snapshot.query.finally(() => { snapshot.expires = Date.now() + PROCESS_CACHE_MS })
  }
  return (await windowsSnapshot.query).get(pid)
}

async function windowsProcessTimes(): Promise<Map<number, number>> {
  const times = new Map<number, number>()
  try {
    const command = "Get-Process | ForEach-Object { try { '{0} {1}' -f $_.Id, ([DateTimeOffset]$_.StartTime).ToUnixTimeMilliseconds() } catch {} }"
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeout: QUERY_TIMEOUT_MS, windowsHide: true })
    for (const line of stdout.split(/\r?\n/)) {
      const match = /^(\d+) (\d+)$/.exec(line.trim())
      if (match !== null) times.set(Number(match[1]), Number(match[2]))
    }
  } catch {
    // An unavailable snapshot preserves the existing liveness behaviour.
  }
  return times
}

/** A fresh query before killing a tree: a poll's snapshot may predate a reused pid. */
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
    // A missing process or an unavailable start time keeps the existing behaviour.
  }
  return undefined
}

function finite(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined
}
