import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountHome } from '../../src/account/homes.js'
import { COPILOT } from '../../src/copilot/name.js'
import type { FileState, Source, Store } from './load.js'
import { emptyBatch, type Batch, type MessageRow, type ParseContext } from './parse.js'
import { rolloutLines } from './rollout.js'
import { placeOf, taskOf } from './task.js'

/**
 * A Copilot CLI session (BTN-215) is `<COPILOT_HOME>/session-state/<id>/events.jsonl`, an event per line
 * `{type, data, id, timestamp, agentId?}`, a resume appending to the same file. A model call is a
 * `session.usage_record`, key `copilot:<event id>`: `usage.inputTokens` is the whole prompt, the cache read and write
 * included, `outputTokens` holds the reasoning. The folder and branch come from `session.start`/`session.resume`.
 * Only `messages` and `sessions` are written, as for a Codex rollout.
 */
const EVENTS = /(?:^|[\\/])session-state[\\/]([^\\/]+)[\\/]events\.jsonl$/
const ID_PREFIX = 'copilot:'
const ENTRYPOINT = 'copilot'

interface Event {
  type?: unknown
  data?: unknown
  id?: unknown
  timestamp?: unknown
  agentId?: unknown
}

export function copilotSession(path: string): string | null {
  return EVENTS.exec(path)?.[1] ?? null
}

/** The events files of the Copilot folders, one per session. */
export async function copilotSources(homes: AccountHome[]): Promise<Source[]> {
  const sources: Source[] = []
  for (const home of homes) {
    if (home.agent !== COPILOT) continue
    const root = join(home.dir, 'session-state')
    for (const session of await folders(root)) {
      const path = join(root, session, 'events.jsonl')
      if (await isFile(path)) sources.push({ path, account: home.key })
    }
  }
  return sources
}

export class CopilotBuilder {
  private readonly batch = emptyBatch()
  private cwd: string | null = null
  private branch: string | null = null
  private firstAt: string | null = null
  private lastAt: string | null = null

  constructor(
    private readonly context: ParseContext,
    private readonly sessionId: string,
  ) {}

  push(text: string): void {
    const event = parseLine(text)
    const data = record(event?.data)
    const at = str(event?.timestamp)
    if (event === undefined || data === undefined || at === null) return
    if (this.firstAt === null || at < this.firstAt) this.firstAt = at
    if (this.lastAt === null || at > this.lastAt) this.lastAt = at
    if (event.type === 'session.start' || event.type === 'session.resume') {
      const context = record(data.context)
      this.cwd = str(context?.cwd) ?? this.cwd
      this.branch = str(context?.branch) ?? this.branch
    } else if (event.type === 'session.usage_record') {
      const id = str(event.id)
      const usage = record(data.usage)
      if (id !== null && usage !== undefined) this.call(`${ID_PREFIX}${id}`, at, usage, str(event.agentId))
    }
  }

  /** The batch of the whole file: a session without one model call with tokens gets no row. */
  finish(): Batch {
    if (this.batch.messages.size === 0) return this.batch
    const launch = this.context.launches.get(this.sessionId)
    this.batch.sessions.set(this.sessionId, {
      sessionId: this.sessionId,
      account: this.context.account,
      project: placeOf(this.cwd).project,
      customTitle: null,
      aiTitle: null,
      launchTask: launch?.task ?? null,
      launchReason: launch?.reason ?? null,
      firstAt: this.firstAt,
      lastAt: this.lastAt,
    })
    return this.batch
  }

  private call(messageId: string, at: string, usage: Record<string, unknown>, agentId: string | null): void {
    const cacheRead = num(usage.cacheReadTokens)
    const cacheWrite = num(usage.cacheWriteTokens)
    const input = Math.max(0, num(usage.inputTokens) - cacheRead - cacheWrite)
    const output = num(usage.outputTokens)
    if (input + cacheRead + cacheWrite + output === 0) return
    const place = placeOf(this.cwd)
    const launch = this.context.launches.get(this.sessionId)
    const row: MessageRow = {
      messageId,
      sessionId: this.sessionId,
      agentId,
      account: this.context.account,
      project: place.project,
      projectDir: place.dir,
      task: taskOf({ launch: launch?.task, branch: this.branch, cwd: this.cwd }),
      branch: this.branch,
      entrypoint: ENTRYPOINT,
      model: str(usage.model),
      speed: null,
      effort: null,
      at: new Date(at).toISOString(),
      input,
      cacheWrite5m: cacheWrite,
      cacheWrite1h: 0,
      cacheRead,
      output,
    }
    this.batch.messages.set(messageId, row)
  }
}

/** A changed events file is read whole, as a Codex rollout: its rows are idempotent by key. */
export async function loadCopilot(source: Source, stored: FileState | undefined, store: Store, context: ParseContext): Promise<number> {
  const session = copilotSession(source.path)
  if (session === null) return 0
  const info = await stat(source.path, { bigint: true })
  const size = Number(info.size)
  const ino = info.ino.toString()
  const mtime = info.mtime.toISOString()
  if (stored !== undefined && stored.size === size && stored.mtime === mtime && stored.ino === ino) return 0
  const builder = new CopilotBuilder(context, session)
  let lines = 0
  for await (const text of rolloutLines(source.path)) {
    builder.push(text)
    lines++
  }
  await store.write(builder.finish(), { ...source, offset: size, size, mtime, ino, head: '', headLen: 0 })
  return lines
}

function parseLine(text: string): Event | undefined {
  if (text.trim() === '') return undefined
  try {
    return record(JSON.parse(text)) as Event | undefined
  } catch {
    return undefined
  }
}

async function folders(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0
}
