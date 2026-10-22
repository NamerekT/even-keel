import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { AccountHome } from '../../src/account/homes.js'
import { responseRows, type ResponseRow } from '../../src/opencode/db.js'
import { databaseFile } from '../../src/opencode/home.js'
import { OPENCODE } from '../../src/opencode/name.js'
import type { FileState, Source, Store } from './load.js'
import { emptyBatch, type Batch, type MessageRow, type ParseContext, type SessionRow } from './parse.js'
import { placeOf, taskOf } from './task.js'

/**
 * An OpenCode account's transcripts are rows of its `data/opencode/opencode.db` (SQLite, WAL), not files (BTN-214): a
 * response is an assistant message, its JSON `data` holding the model (`providerID`, `modelID`), the folder
 * (`path.cwd`) and the tokens. `tokens.input` leaves out the cache read and write; `output` leaves out `reasoning`,
 * which is billed as output. A subagent's session (`parent_id`) counts under its parent's, as a Claude subagent does.
 * Only `messages` and `sessions` are written, as for a Codex rollout.
 */
const ID_PREFIX = 'opencode:'
const ENTRYPOINT = 'opencode'

export function openCodeSources(homes: AccountHome[]): Source[] {
  return homes
    .filter((home) => home.agent === OPENCODE && existsSync(databaseFile(home.dir)))
    .map((home) => ({ path: databaseFile(home.dir), account: home.key }))
}

/** The batch of every response of the database. */
export function openCodeBatch(rows: ResponseRow[], context: ParseContext): Batch {
  const batch = emptyBatch()
  for (const row of rows) {
    const data = parse(row.data)
    const tokens = record(data?.tokens)
    if (data === undefined || tokens === undefined) continue
    const cache = record(tokens.cache)
    const usage = { input: num(tokens.input), cacheRead: num(cache?.read), cacheWrite: num(cache?.write), output: num(tokens.output) + num(tokens.reasoning) }
    if (usage.input + usage.cacheRead + usage.cacheWrite + usage.output === 0) continue
    const sessionId = row.parent ?? row.session
    const cwd = str(record(data.path)?.cwd)
    const place = placeOf(cwd)
    const launch = context.launches.get(sessionId)
    const at = new Date(row.at).toISOString()
    const message: MessageRow = {
      messageId: `${ID_PREFIX}${row.id}`,
      sessionId,
      agentId: row.parent === null ? null : row.session,
      account: context.account,
      project: place.project,
      projectDir: place.dir,
      task: taskOf({ launch: launch?.task, branch: null, cwd }),
      branch: null,
      entrypoint: ENTRYPOINT,
      model: str(data.modelID),
      speed: null,
      effort: null,
      at,
      input: usage.input,
      cacheWrite5m: usage.cacheWrite,
      cacheWrite1h: 0,
      cacheRead: usage.cacheRead,
      output: usage.output,
    }
    batch.messages.set(message.messageId, message)
    const known = batch.sessions.get(sessionId)
    const session: SessionRow = known ?? {
      sessionId,
      account: context.account,
      project: place.project,
      customTitle: null,
      aiTitle: null,
      launchTask: launch?.task ?? null,
      launchReason: launch?.reason ?? null,
      firstAt: at,
      lastAt: at,
    }
    if (row.parent === null && row.title !== '') session.aiTitle = row.title
    if (at < session.firstAt!) session.firstAt = at
    if (at > session.lastAt!) session.lastAt = at
    batch.sessions.set(sessionId, session)
  }
  return batch
}

/**
 * The whole database is read again whenever it or its WAL changed: OpenCode writes the WAL first, so the main file
 * alone may not move for a while. Its rows are idempotent by key.
 */
export async function loadOpenCode(source: Source, stored: FileState | undefined, store: Store, context: ParseContext): Promise<number> {
  const [main, wal] = await Promise.all([stat(source.path, { bigint: true }), stat(`${source.path}-wal`, { bigint: true }).catch(() => null)])
  const size = Number(main.size) + Number(wal?.size ?? 0n)
  const mtime = new Date(Math.max(main.mtime.getTime(), wal?.mtime.getTime() ?? 0)).toISOString()
  const ino = main.ino.toString()
  if (stored !== undefined && stored.size === size && stored.mtime === mtime && stored.ino === ino) return 0
  const rows = await responseRows(source.path)
  if (rows === undefined) throw new Error('the OpenCode database could not be read')
  await store.write(openCodeBatch(rows, context), { ...source, offset: size, size, mtime, ino, head: '', headLen: 0 })
  return rows.length
}

function parse(text: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(text))
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
