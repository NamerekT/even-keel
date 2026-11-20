import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { descendants, killLeftovers, type ProcessRef } from '../claude/tree.js'
import { processStartedAt } from '../codex/process.js'

const run = promisify(execFile)
const LIST_TIMEOUT_MS = 15_000

/**
 * Even Keel's own mark of a turn process of OpenCode and Copilot, whose CLIs put no session id into what they run
 * (BTN-1389): `taskMark` of the task, since OpenCode's session id is not known when its first turn starts.
 */
export const TASK_MARK = 'EVEN_KEEL_TASK'

/**
 * The variables an agent CLI puts into the environment of every command it runs, holding the session's id as the
 * launch log keeps it: Claude's session id (seen live, CLI 2.1.329) and Codex's thread id (found in its binary); and
 * Even Keel's `TASK_MARK`.
 */
export const SESSION_MARKS = ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', TASK_MARK]

/** A task's mark: a task key is not unique between projects, so the project's GUID goes with it. Session ids hold no `/`. */
export function taskMark(project: string, task: string): string {
  return `${project}/${task}`
}

/** A turn's environment with the start's task mark, or without any inherited one when the start has none. */
export function markedEnv(env: NodeJS.ProcessEnv, mark: string | undefined): NodeJS.ProcessEnv {
  const { [TASK_MARK]: _inherited, ...rest } = env
  return mark === undefined ? rest : { ...rest, [TASK_MARK]: mark }
}

/** A process with its environment as `NAME=value` lines; `env` absent — it could not be read. */
export interface ProcessEnv {
  pid: number
  ppid: number
  command: string
  env?: string[]
}

export type ProcessScan = () => Promise<ProcessEnv[]>

export interface Orphan {
  pid: number
  command: string
  session: string
}

/** The session of `ids` a process's environment names. */
export function markOf(env: string[], ids: ReadonlySet<string>): string | undefined {
  for (const line of env) {
    const at = line.indexOf('=')
    if (at > 0 && SESSION_MARKS.includes(line.slice(0, at)) && ids.has(line.slice(at + 1))) return line.slice(at + 1)
  }
  return undefined
}

/**
 * The processes marked with one of `ids` and every process under them: Chrome clears the environment of what it
 * starts, so its processes are found by a marked parent. `self` and the processes above it are never taken.
 */
export function orphansIn(table: ProcessEnv[], ids: ReadonlySet<string>, self = process.pid): Orphan[] {
  const parents = new Map(table.map(({ pid, ppid }) => [pid, ppid]))
  const spared = new Set<number>()
  for (let pid: number | undefined = self; pid !== undefined && pid > 0 && !spared.has(pid); pid = parents.get(pid)) spared.add(pid)
  const commands = new Map(table.map(({ pid, command }) => [pid, command]))
  const pairs = table.map(({ pid, ppid }): [number, number] => [pid, ppid])
  const found = new Map<number, Orphan>()
  for (const { pid, command, env } of table) {
    const session = env === undefined || spared.has(pid) ? undefined : markOf(env, ids)
    if (session === undefined || found.has(pid)) continue
    found.set(pid, { pid, command, session })
    for (const child of descendants(pairs, pid)) {
      if (!spared.has(child) && !found.has(child)) found.set(child, { pid: child, command: commands.get(child) ?? '?', session })
    }
  }
  return [...found.values()]
}

/** The parent and the name from `/proc/<pid>/stat`, whose name is in parentheses and may hold either. */
export function parseLinuxStat(stat: string): { ppid: number; command: string } | undefined {
  const open = stat.indexOf('(')
  const close = stat.lastIndexOf(')')
  const ppid = Number(stat.slice(close + 2).split(/\s+/)[1])
  if (open < 0 || close < open || !Number.isSafeInteger(ppid)) return undefined
  return { ppid, command: stat.slice(open + 1, close) }
}

/** `ps -E` lines: the command, then the environment, all space-separated; the session ids hold no spaces. */
export function parseDarwinTable(text: string): ProcessEnv[] {
  const table: ProcessEnv[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)(.*)$/.exec(line)
    if (match === null) continue
    const env = match[4]!.split(/\s+/).filter((word) => /^[A-Za-z_]\w*=/.test(word))
    table.push({ pid: Number(match[1]), ppid: Number(match[2]), command: basename(match[3]!), env })
  }
  return table
}

async function linuxTable(): Promise<ProcessEnv[]> {
  const pids = (await readdir('/proc')).filter((name) => /^\d+$/.test(name))
  const rows = await Promise.all(
    pids.map(async (name): Promise<ProcessEnv | undefined> => {
      const stat = parseLinuxStat(await readFile(`/proc/${name}/stat`, 'utf8').catch(() => ''))
      if (stat === undefined) return undefined
      // Another user's environment is unreadable, and a process may be gone by now.
      const env = await readFile(`/proc/${name}/environ`, 'utf8').then((text) => text.split('\0'), () => undefined)
      return { pid: Number(name), ...stat, ...(env === undefined ? {} : { env }) }
    }),
  )
  return rows.filter((row) => row !== undefined)
}

async function darwinTable(): Promise<ProcessEnv[]> {
  const { stdout } = await run('ps', ['-E', '-A', '-ww', '-o', 'pid=,ppid=,command='], { timeout: LIST_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 })
  return parseDarwinTable(stdout)
}

/** Windows has no plain way to read another process's environment: there the stop's own tree listing has to do. */
function systemScan(): ProcessScan | undefined {
  return process.platform === 'linux' ? linuxTable : process.platform === 'darwin' ? darwinTable : undefined
}

export interface OrphanOptions {
  scan?: ProcessScan | undefined
  kill?: (processes: ProcessRef[]) => Promise<void>
  startedAt?: (pid: number) => Promise<number | undefined>
  log?: (line: string) => void
  now?: () => number
}

/**
 * Kills the live processes of the given sessions of a task (BTN-1268): those the stop's tree listing misses, because
 * the session had died before the cleanup and its children went to init, or they detached themselves (`setsid`,
 * `nohup`, a double fork). Only the ids the cleanup gives are looked for, so a hand session, a live one and the
 * package gateway are never touched. Linux and macOS only, see `systemScan`.
 */
export async function killOrphans(ids: Iterable<string>, task: string, options: OrphanOptions = {}): Promise<void> {
  const { scan = systemScan(), kill = killLeftovers, startedAt = processStartedAt, log = console.log, now = Date.now } = options
  const wanted = new Set(ids)
  if (wanted.size === 0 || scan === undefined) return
  let orphans: Orphan[]
  try {
    orphans = orphansIn(await scan(), wanted)
  } catch (error) {
    log(`cleanup: ${task}: looking for its sessions' orphaned processes failed: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (orphans.length === 0) return
  const starts = await Promise.all(orphans.map(({ pid }) => startedAt(pid)))
  await kill(orphans.map(({ pid }, index) => ({ pid, ...(starts[index] === undefined ? {} : { startedAt: starts[index] }) })))
  orphans.forEach(({ pid, command, session }, index) => {
    const start = starts[index]
    const alive = start === undefined ? '' : `, alive ${Math.round((now() - start) / 60_000)} min`
    log(`cleanup: ${task}: killed the orphaned process ${pid} (${command}) of the ${session.includes('/') ? 'task mark' : 'session'} ${session}${alive}`)
  })
}
