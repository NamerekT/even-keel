import { mkdirSync } from 'node:fs'
import { open, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentEntry } from '../sessions/agents.js'
import { writeAtomic } from '../storage/atomic.js'
import { SCHEMA_VERSION } from '../storage/schema.js'
import { CODEX } from './name.js'

/**
 * A Codex session Even Keel started. Codex has no list of its background sessions: each turn is a `codex exec`
 * process of its own, so Even Keel keeps the session (`state/codex/sessions/<id>.json`) and the `--json` output of
 * its last turn (`state/codex/turns/<name>-<ms>.jsonl`).
 */
export interface CodexSession {
  sessionId: string
  name: string
  cwd: string
  /** The key of the account folder it runs in. */
  account: string
  startedAt: number
  /** The process of the last turn. */
  pid: number
  /** The `--json` output of the last turn. */
  out: string
  stopped?: boolean
}

const TAIL_BYTES = 64 * 1024

export class TurnRegistry {
  private readonly sessionsDir: string
  private readonly turnsDir: string

  constructor(dir: string) {
    this.sessionsDir = join(dir, 'sessions')
    this.turnsDir = join(dir, 'turns')
  }

  async list(account: string): Promise<CodexSession[]> {
    const names = await readdir(this.sessionsDir).catch(() => [])
    const texts = await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) => readFile(join(this.sessionsDir, name), 'utf8').catch(() => '')))
    return texts.map(parseSession).filter((session): session is CodexSession => session !== undefined && session.account === account)
  }

  async get(sessionId: string): Promise<CodexSession | undefined> {
    if (!/^[0-9a-f-]+$/i.test(sessionId)) return undefined
    return parseSession(await readFile(join(this.sessionsDir, `${sessionId}.json`), 'utf8').catch(() => ''))
  }

  save(session: CodexSession): void {
    mkdirSync(this.sessionsDir, { recursive: true })
    writeAtomic(join(this.sessionsDir, `${session.sessionId}.json`), `${JSON.stringify({ version: SCHEMA_VERSION, ...session }, null, 2)}\n`)
  }

  /** A new file for a turn's output. */
  turnFile(name: string, at: number): string {
    mkdirSync(this.turnsDir, { recursive: true })
    return join(this.turnsDir, `${name}-${at}.jsonl`)
  }
}

export function parseSession(raw: string): CodexSession | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const { sessionId, name, cwd, account, startedAt, pid, out, stopped } = value as Record<string, unknown>
  if (typeof sessionId !== 'string' || typeof name !== 'string' || typeof cwd !== 'string' || typeof account !== 'string') return undefined
  if (typeof startedAt !== 'number' || typeof pid !== 'number' || typeof out !== 'string') return undefined
  return { sessionId, name, cwd, account, startedAt, pid, out, ...(stopped === true ? { stopped } : {}) }
}

/** The session as the chain sees it: busy while its turn runs, resting and idle between turns. */
export function entryOf(session: CodexSession, live: boolean): AgentEntry {
  const { sessionId, name, cwd, account, startedAt } = session
  const entry: AgentEntry = { id: sessionId, sessionId, kind: CODEX, name, cwd, account, startedAt }
  if (session.stopped === true) return { ...entry, state: 'stopped' }
  if (live) return { ...entry, pid: session.pid, status: 'busy', state: 'working' }
  return { ...entry, status: 'idle', state: 'working', resting: true }
}

/** The thread a turn runs in, from the first event of `codex exec --json`. */
export function threadOf(stdout: string): string | undefined {
  for (const line of stdout.split('\n')) {
    const event = parse(line)
    if (event?.type === 'thread.started' && typeof event.thread_id === 'string') return event.thread_id
  }
  return undefined
}

/** The turn's last event says it is over. */
export function turnEnded(stdout: string): boolean {
  const lines = stdout.trimEnd().split('\n')
  const type = parse(lines.at(-1) ?? '')?.type
  return type === 'turn.completed' || type === 'turn.failed'
}

/** The last bytes of a turn's output: its end is all `turnEnded` needs. */
export async function outputTail(file: string): Promise<string> {
  let handle
  try {
    handle = await open(file, 'r')
  } catch {
    return ''
  }
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, TAIL_BYTES)
    const chunk = Buffer.alloc(length)
    await handle.read(chunk, 0, length, size - length)
    return chunk.toString('utf8')
  } finally {
    await handle.close()
  }
}

function parse(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
