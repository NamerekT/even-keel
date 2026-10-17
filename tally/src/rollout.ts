import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createZstdDecompress } from 'node:zlib'
import { emptyBatch, type Batch, type MessageRow, type ParseContext } from './parse.js'
import { placeOf, taskOf } from './task.js'

/**
 * A Codex rollout (`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`, older ones compressed to `.jsonl.zst`):
 * lines `{timestamp, type, payload}`. A response is a `token_usage_record` (codex-cli 0.162: `response_id` and the
 * response's `usage`); a CLI that wrote none (0.148) leaves only `token_count`, whose `last_token_usage` is then the
 * response, keyed by the session and the running total. Only `messages` and `sessions` are written: `lines` stay Claude's.
 */
const ROLLOUT = /(?:^|[\\/])rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl(?:\.zst)?$/i

interface Line {
  timestamp?: unknown
  type?: unknown
  payload?: Record<string, unknown>
}

interface Usage {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

interface Turn {
  model: string | null
  effort: string | null
}

export function rolloutSession(path: string): string | null {
  return ROLLOUT.exec(path)?.[1] ?? null
}

export class RolloutBuilder {
  private readonly records = new Map<string, MessageRow>()
  private readonly counts = new Map<number, MessageRow>()
  private readonly recordTotals = new Set<number>()
  private turn: Turn = { model: null, effort: null }
  private cwd: string | null = null
  private branch: string | null = null
  private entrypoint = 'codex'
  private firstAt: string | null = null
  private lastAt: string | null = null

  constructor(
    private readonly context: ParseContext,
    private readonly sessionId: string,
  ) {}

  push(text: string): void {
    const line = parseLine(text)
    const payload = line?.payload
    if (line === undefined || payload === undefined) return
    const at = str(line.timestamp)
    if (at !== null) {
      if (this.firstAt === null || at < this.firstAt) this.firstAt = at
      if (this.lastAt === null || at > this.lastAt) this.lastAt = at
    }
    if (line.type === 'session_meta') {
      this.cwd = str(payload.cwd) ?? this.cwd
      this.branch = str(record(payload.git)?.branch) ?? this.branch
      this.entrypoint = entrypointOf(str(payload.originator))
    } else if (line.type === 'turn_context') {
      this.cwd = str(payload.cwd) ?? this.cwd
      this.turn = { model: str(payload.model), effort: str(payload.effort) }
    } else if (line.type === 'token_usage_record') {
      const id = str(payload.response_id)
      const usage = usageOf(record(payload.usage))
      if (id === null || usage === null) return
      const total = record(payload.thread_token_usage)?.total_tokens
      if (typeof total === 'number') this.recordTotals.add(total)
      this.records.set(id, this.row(id, at, usage))
    } else if (line.type === 'event_msg' && payload.type === 'token_count') {
      const info = record(payload.info)
      const total = record(info?.total_token_usage)?.total_tokens
      const usage = usageOf(record(info?.last_token_usage))
      if (typeof total !== 'number' || usage === null || this.counts.has(total)) return
      this.counts.set(total, this.row(`codex:${this.sessionId}:${total}`, at, usage))
    }
  }

  /** The batch of the whole rollout: a `token_count` a record already gave is not counted again. */
  finish(): Batch {
    const batch = emptyBatch()
    for (const [id, row] of this.records) batch.messages.set(id, row)
    for (const [total, row] of this.counts) if (!this.recordTotals.has(total)) batch.messages.set(row.messageId, row)
    if (batch.messages.size === 0) return batch
    const launch = this.context.launches.get(this.sessionId)
    batch.sessions.set(this.sessionId, {
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
    return batch
  }

  private row(messageId: string, at: string | null, usage: Usage): MessageRow {
    const place = placeOf(this.cwd)
    const launch = this.context.launches.get(this.sessionId)
    return {
      messageId,
      sessionId: this.sessionId,
      agentId: null,
      account: this.context.account,
      project: place.project,
      projectDir: place.dir,
      task: taskOf({ launch: launch?.task, branch: this.branch, cwd: this.cwd }),
      branch: this.branch,
      entrypoint: this.entrypoint,
      model: this.turn.model,
      speed: null,
      effort: this.turn.effort,
      at,
      input: usage.input,
      cacheWrite5m: usage.cacheWrite,
      cacheWrite1h: 0,
      cacheRead: usage.cacheRead,
      output: usage.output,
    }
  }
}

/** Every line of a rollout, a compressed one unpacked on the way. */
export async function* rolloutLines(path: string): AsyncGenerator<string> {
  const file = createReadStream(path)
  const input = path.endsWith('.zst') ? file.pipe(createZstdDecompress()) : file
  file.on('error', (error) => input.destroy(error))
  yield* createInterface({ input, crlfDelay: Infinity })
}

// `input_tokens` includes the cached and the cache-written ones; `output_tokens` includes the reasoning.
function usageOf(usage: Record<string, unknown> | undefined): Usage | null {
  if (usage === undefined) return null
  const cacheRead = num(usage.cached_input_tokens)
  const cacheWrite = num(usage.cache_write_input_tokens)
  const result = { input: Math.max(0, num(usage.input_tokens) - cacheRead - cacheWrite), cacheRead, cacheWrite, output: num(usage.output_tokens) }
  return result.input + result.cacheRead + result.cacheWrite + result.output === 0 ? null : result
}

// 'codex_exec' → 'codex-exec', 'Codex Desktop' → 'codex-desktop'.
function entrypointOf(originator: string | null): string {
  const slug = (originator ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (slug === '' || slug === 'codex') return 'codex'
  return slug.startsWith('codex-') ? slug : `codex-${slug}`
}

function parseLine(text: string): Line | undefined {
  if (text.trim() === '') return undefined
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null ? (value as Line) : undefined
  } catch {
    return undefined
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
