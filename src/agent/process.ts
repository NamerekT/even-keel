import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const QUERY_TIMEOUT_MS = 5_000
const KILL_TIMEOUT_MS = 5_000
const STOP_POLL_MS = 500

export interface ProcessRow {
  pid: number
  ppid: number
  pgid: number
}

export interface StopWaits {
  termMs: number
  killMs?: number
  pollMs?: number
}

/**
 * Stops a detached turn and waits for its pid to go. A turn that outlives `termMs` after `SIGTERM` (one frozen by
 * `SIGSTOP`, EKR-64) gets `SIGKILL` to a fresh tree, but only while `stillOurs` confirms the pid is still the turn's
 * own (BTN-760). False when the pid outlived both waits or stopped being the turn's.
 */
export async function stopTree(pid: number, stillOurs: () => Promise<boolean>, waits: StopWaits): Promise<boolean> {
  const { termMs, killMs = KILL_TIMEOUT_MS, pollMs = STOP_POLL_MS } = waits
  await killTree(pid)
  if (await gone(pid, termMs, pollMs)) return true
  if (!(await stillOurs())) return false
  await killTree(pid, 'SIGKILL')
  return gone(pid, killMs, pollMs)
}

async function gone(pid: number, timeoutMs: number, pollMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (isAlive(pid)) {
    if (Date.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  return true
}

/**
 * Kills a detached turn with its children: on Windows a shell wrapper dies alone and leaves the agent running. On Unix
 * an agent may run a tool's command in a session of its own, out of the turn's group (BTN-643): the turn's descendants
 * are found by parent from one snapshot taken right before the kill, and their groups are signalled too.
 */
export async function killTree(pid: number, kind: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  if (process.platform === 'win32') {
    await run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(() => undefined)
    return
  }
  const table = await processTable()
  const { groups, pids } = table === undefined ? { groups: [pid], pids: [] } : treeTargets(table, pid, process.pid)
  for (const group of groups) {
    if (!signal(-group, kind) && group === pid) signal(pid, kind)
  }
  for (const loose of pids) signal(loose, kind)
}

/** The groups to signal and the descendants to signal alone: those sharing the service's own group. */
export function treeTargets(table: ProcessRow[], root: number, self: number): { groups: number[]; pids: number[] } {
  const own = table.find((row) => row.pid === self)?.pgid
  const tree = table.filter((row) => row.pid === root)
  for (let i = 0; i < tree.length; i++) tree.push(...table.filter((row) => row.ppid === tree[i]!.pid))
  const groups = new Set([root])
  const pids: number[] = []
  for (const row of tree) {
    if (row.pgid === own) pids.push(row.pid)
    else if (row.pgid > 1) groups.add(row.pgid)
  }
  return { groups: [...groups], pids }
}

export function parseProcessTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line)
    if (match !== null) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]) })
  }
  return rows
}

async function processTable(): Promise<ProcessRow[] | undefined> {
  try {
    const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,pgid='], { timeout: QUERY_TIMEOUT_MS })
    const rows = parseProcessTable(stdout)
    return rows.length === 0 ? undefined : rows
  } catch {
    return undefined
  }
}

function signal(target: number, kind: NodeJS.Signals): boolean {
  try {
    process.kill(target, kind)
    return true
  } catch {
    return false
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
