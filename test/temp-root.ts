import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Under the OS temp folder; the workstation's Defender exclusion names this exact folder (BTN-1316). */
export const RUNS_FOLDER = 'even-keel-tests'
export const RUN_FILE = 'run.json'
export const STALE_MS = 24 * 60 * 60 * 1000
export const TEMP_KEYS = ['TEMP', 'TMP', 'TMPDIR'] as const

export interface RunMark {
  pid: number
  started: number
}

/** A run folder found by the sweep: its mark, when it was readable, and the folder's own time. */
export interface RunFolder {
  mark: RunMark | null
  modifiedMs: number
}

/** Another run's folder goes once its process is gone or it is older than a day (a pid may be reused); without a mark — by the folder's age. */
export function isStale(folder: RunFolder, now: number, alive: (pid: number) => boolean): boolean {
  if (folder.mark === null) return now - folder.modifiedMs > STALE_MS
  return now - folder.mark.started > STALE_MS || !alive(folder.mark.pid)
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function markOf(folder: string): RunMark | null {
  try {
    const mark = JSON.parse(readFileSync(join(folder, RUN_FILE), 'utf8')) as Partial<RunMark>
    return Number.isInteger(mark.pid) && Number.isFinite(mark.started) ? { pid: mark.pid!, started: mark.started! } : null
  } catch {
    return null
  }
}

/** Removes what interrupted runs left in `base`; returns the names it removed. */
export function sweepRuns(base: string, now = Date.now(), alive = pidAlive): string[] {
  let names: string[]
  try {
    names = readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
  return names.filter((name) => {
    const folder = join(base, name)
    try {
      if (!isStale({ mark: markOf(folder), modifiedMs: statSync(folder).mtimeMs }, now, alive)) return false
      rmSync(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      return true
    } catch {
      return false
    }
  })
}

/** `<base>/<pid>-<6 chars>` with the run's mark; short, so deep PGlite and worktree paths stay under Windows' MAX_PATH. */
export function createRunRoot(base: string, pid = process.pid, now = Date.now()): string {
  mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, `${pid}-`))
  writeFileSync(join(root, RUN_FILE), JSON.stringify({ pid, started: now } satisfies RunMark))
  return root
}

function countEntries(folder: string): number {
  try {
    return readdirSync(folder, { recursive: true }).length
  } catch {
    return 0
  }
}

/** Removes the run's root; returns how many entries stayed (a live child process may hold a file) — 0 when the root is gone. */
export function removeRunRoot(root: string): number {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    return 0
  } catch {
    return Math.max(countEntries(root), 1)
  }
}
