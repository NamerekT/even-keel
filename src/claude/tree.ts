import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const LIST_TIMEOUT_MS = 15_000

/** `pid ppid` lines, as both process listings below print them. */
export function parseProcessTable(text: string): [number, number][] {
  const table: [number, number][] = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (match !== null) table.push([Number(match[1]), Number(match[2])])
  }
  return table
}

/** Every process under `root`, parents before their children. */
export function descendants(table: [number, number][], root: number): number[] {
  const found: number[] = []
  const seen = new Set([root])
  for (let index = -1; index < found.length; index++) {
    const parent = index < 0 ? root : found[index]
    for (const [pid, ppid] of table) {
      if (ppid !== parent || seen.has(pid)) continue
      seen.add(pid)
      found.push(pid)
    }
  }
  return found
}

/**
 * The processes a session started. On Linux and macOS it is taken while the session lives: once it is gone, its orphans
 * are reparented and no longer lead back to it. Windows keeps an orphan's `ParentProcessId`, so there it may finish later.
 */
export async function descendantsOf(pid: number): Promise<number[]> {
  try {
    const { stdout } =
      process.platform === 'win32'
        ? await run(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.ParentProcessId }"],
            { timeout: LIST_TIMEOUT_MS, windowsHide: true },
          )
        : await run('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], { timeout: LIST_TIMEOUT_MS })
    return descendants(parseProcessTable(stdout), pid)
  } catch {
    return []
  }
}

/**
 * Kills what is left of a stopped session's processes. `claude stop` ends the session's own process but leaves the
 * background commands it started running (CLI 2.1.302 on Windows: the `bash.exe` of a `run_in_background` command
 * outlives it), and they keep the worktree busy. Most exit with the session, and a `taskkill` costs about half a second
 * even on a dead pid, so only the live ones get one, all at once.
 */
export async function killLeftovers(pids: number[]): Promise<void> {
  await Promise.all(
    pids.filter(isAlive).map(async (pid) => {
      try {
        if (process.platform === 'win32') await run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
        else process.kill(pid, 'SIGTERM')
      } catch {
        // already gone, or taken down with its parent's tree
      }
    }),
  )
}

export function isAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
