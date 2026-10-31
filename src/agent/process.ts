import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const QUERY_TIMEOUT_MS = 5_000

export interface ProcessRow {
  pid: number
  ppid: number
  pgid: number
}

/**
 * Kills a detached turn with its children: on Windows a shell wrapper dies alone and leaves the agent running. On Unix
 * an agent may run a tool's command in a session of its own, out of the turn's group (BTN-643): the turn's descendants
 * are found by parent from one snapshot taken right before the kill, and their groups are signalled too.
 */
export async function killTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(() => undefined)
    return
  }
  const table = await processTable()
  const { groups, pids } = table === undefined ? { groups: [pid], pids: [] } : treeTargets(table, pid, process.pid)
  for (const group of groups) {
    if (!signal(-group) && group === pid) signal(pid)
  }
  for (const loose of pids) signal(loose)
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

function signal(target: number): boolean {
  try {
    process.kill(target, 'SIGTERM')
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
