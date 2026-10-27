import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Ask } from '../../sessions/ask.js'
import type { AgentEntry, AgentStatus } from '../../sessions/agents.js'
import { writeAtomic } from '../../storage/atomic.js'
import { SCHEMA_VERSION } from '../../storage/schema.js'

export const SDK_KIND = 'sdk'

/**
 * A Claude session Even Keel runs through the Agent SDK (`state/claude-sdk/sessions/<id>.json`): `claude agents`
 * does not list it, so Even Keel keeps it itself, as it keeps Codex sessions.
 */
export interface SdkSession {
  sessionId: string
  name: string
  cwd: string
  /** The key of the account folder it runs in. */
  account: string
  startedAt: number
  /** The executor that holds the CLI (`executor.ts`) and the pipe it serves. */
  executor: number
  pipe: string
  /** The CLI's process, once the executor named it. */
  cli?: number
  /** The model it was started with, as it went to the CLI. */
  model: string | null
  /** The Remote Control session (`cse_…`) a resumed session goes back to. */
  bridge?: string
  stopped?: boolean
}

export class SdkRegistry {
  private readonly sessionsDir: string
  private readonly executorsDir: string

  constructor(dir: string) {
    this.sessionsDir = join(dir, 'sessions')
    this.executorsDir = join(dir, 'executors')
  }

  async list(account: string): Promise<SdkSession[]> {
    let names: string[]
    try {
      names = readdirSync(this.sessionsDir)
    } catch {
      return []
    }
    return names.filter((name) => name.endsWith('.json')).map((name) => this.read(name.slice(0, -5)))
      .filter((session): session is SdkSession => session !== undefined && session.account === account)
  }

  async get(sessionId: string): Promise<SdkSession | undefined> {
    if (!/^[\w-]+$/.test(sessionId)) return undefined
    return this.read(sessionId)
  }

  private read(sessionId: string): SdkSession | undefined {
    try {
      return parseSdkSession(readFileSync(join(this.sessionsDir, `${sessionId}.json`), 'utf8'))
    } catch {
      return undefined
    }
  }

  save(session: SdkSession): void {
    mkdirSync(this.sessionsDir, { recursive: true })
    writeAtomic(join(this.sessionsDir, `${session.sessionId}.json`), `${JSON.stringify({ version: SCHEMA_VERSION, ...session }, null, 2)}\n`)
  }

  /** The executor's log and the file its backlog spills into. */
  executorFiles(sessionId: string, at: number): { log: string; spill: string } {
    mkdirSync(this.executorsDir, { recursive: true })
    const base = join(this.executorsDir, `${sessionId}-${at}`)
    return { log: `${base}.log`, spill: `${base}.spill.jsonl` }
  }
}

export function parseSdkSession(raw: string): SdkSession | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const { sessionId, name, cwd, account, startedAt, executor, pipe, cli, model, bridge, stopped } = value as Record<string, unknown>
  if (typeof sessionId !== 'string' || typeof name !== 'string' || typeof cwd !== 'string' || typeof account !== 'string') return undefined
  if (typeof startedAt !== 'number' || typeof executor !== 'number' || typeof pipe !== 'string') return undefined
  return {
    sessionId,
    name,
    cwd,
    account,
    startedAt,
    executor,
    pipe,
    ...(typeof cli === 'number' ? { cli } : {}),
    model: typeof model === 'string' ? model : null,
    ...(typeof bridge === 'string' ? { bridge } : {}),
    ...(stopped === true ? { stopped } : {}),
  }
}

/** What the host knows of a session it is connected to. */
export interface SdkTurn {
  status: Extract<AgentStatus, 'busy' | 'idle' | 'waiting'>
  ask: Ask | null
}

/**
 * The session as the chain sees it. A live executor is a live session, between turns too: the CLI waits on its stdin
 * for the next message. Until the host is connected to it the turn is taken as running.
 */
export function sdkEntryOf(session: SdkSession, alive: boolean, turn: SdkTurn | null): AgentEntry {
  const { sessionId, name, cwd, account, startedAt, model } = session
  const entry: AgentEntry = { id: sessionId, sessionId, kind: SDK_KIND, name, cwd, account, startedAt, ...(model !== null && { model }) }
  if (session.stopped === true) return { ...entry, state: 'stopped' }
  if (!alive) return { ...entry, state: 'done' }
  const pid = session.cli ?? session.executor
  const status = turn?.status ?? 'busy'
  return { ...entry, pid, status, state: status === 'waiting' ? 'blocked' : 'working', steers: true, ...(turn?.ask != null && { ask: turn.ask }) }
}
