import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { polledProcessStartedAt, processBelongsToTurn, processStartedAt } from '../codex/process.js'

const run = promisify(execFile)
const LIST_TIMEOUT_MS = 15_000

export interface ProcessRef {
  pid: number
  startedAt?: number
}

type ProcessRow = [pid: number, ppid: number, startedAt?: number]

/** `pid ppid [creation time in ms]` lines; inaccessible creation times stay unknown. */
export function parseProcessTable(text: string): ProcessRow[] {
  const table: ProcessRow[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)(?:\s+(\d+))?\s*$/.exec(line)
    if (match !== null) table.push(match[3] === undefined ? [Number(match[1]), Number(match[2])] : [Number(match[1]), Number(match[2]), Number(match[3])])
  }
  return table
}

/** Every process under `root`, parents before their children. */
export function descendants(table: [number, number][], root: number): number[] {
  return descendantProcesses(table, { pid: root }).map(({ pid }) => pid)
}

/** Windows retains old parent pids: a child older than its current parent belongs to an earlier tree. */
export function descendantProcesses(table: ProcessRow[], root: ProcessRef): ProcessRef[] {
  const rootTime = table.find(([pid]) => pid === root.pid)?.[2]
  if (!processBelongsToTurn(rootTime, root.startedAt, 0)) return []
  const parentRoot = { pid: root.pid, startedAt: rootTime ?? root.startedAt }
  const found: ProcessRef[] = []
  const seen = new Set([root.pid])
  for (let index = -1; index < found.length; index++) {
    const parent = index < 0 ? parentRoot : found[index]!
    for (const [pid, ppid, startedAt] of table) {
      if (ppid !== parent.pid || seen.has(pid)) continue
      if (startedAt !== undefined && parent.startedAt !== undefined && startedAt < parent.startedAt) continue
      seen.add(pid)
      found.push({ pid, ...(startedAt === undefined ? {} : { startedAt }) })
    }
  }
  return found
}

/**
 * The processes a session started. On Linux and macOS it is taken while the session lives: once it is gone, its orphans
 * are reparented and no longer lead back to it. Windows keeps an orphan's `ParentProcessId`, so there it may finish later.
 */
export async function descendantsOf(root: ProcessRef): Promise<ProcessRef[]> {
  try {
    const { stdout } =
      process.platform === 'win32'
        ? await run(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process | ForEach-Object { $start = ''; try { $start = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } catch {}; '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $start }"],
            { timeout: LIST_TIMEOUT_MS, windowsHide: true },
          )
        : await run('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], { timeout: LIST_TIMEOUT_MS })
    const table = parseProcessTable(stdout)
    if (process.platform !== 'win32') {
      const candidates = new Set([root.pid, ...descendants(table.map(([pid, ppid]) => [pid, ppid]), root.pid)])
      await Promise.all(table.filter(([pid]) => candidates.has(pid)).map(async (row) => { row[2] = await processStartedAt(row[0]) }))
    }
    return descendantProcesses(table, root)
  } catch {
    return []
  }
}

/**
 * Kills what is left of a stopped session's processes. `claude stop` ends the session's own process but leaves the
 * background commands it started running (CLI 2.1.302 on Windows: the `bash.exe` of a `run_in_background` command
 * outlives it), and they keep the worktree busy. Most exit with the session, and a `taskkill` costs about half a second
 * even on a dead pid, so only the live ones get one, all at once. Each saved process is checked again, without `/T`:
 * an unchecked descendant of a reused pid must never be killed with it.
 */
export async function killLeftovers(processes: ProcessRef[]): Promise<void> {
  await Promise.all(
    processes.map(async (saved) => {
      const { pid } = saved
      if (!isAlive(pid) || !sameProcess(saved, await processStartedAt(pid))) return
      try {
        if (process.platform === 'win32') await run('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true })
        else process.kill(pid, 'SIGTERM')
      } catch {
        // already gone
      }
    }),
  )
}

export function sameProcess(saved: ProcessRef, currentStart: number | undefined): boolean {
  return saved.startedAt === undefined || currentStart === undefined || saved.startedAt === currentStart
}

export async function sessionProcessAlive(pid: number | undefined, recordedAt: number | undefined, fresh = false): Promise<boolean> {
  if (pid === undefined || !isAlive(pid)) return false
  const startedAt = await (fresh ? processStartedAt(pid) : polledProcessStartedAt(pid))
  return processBelongsToTurn(startedAt, recordedAt, 0)
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
