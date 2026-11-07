import type { SessionView } from '../state.js'
import type { Queryable } from '../storage/database.js'
import { idleBeforePrompt } from './boot.js'

interface Identity {
  sessionId: string
  cwd: string
  task?: string
  name?: string
  project?: string
}

/** What the first line of a pair still waits for: a copied resume's transcript, or the model's first answer. */
export type RareWaiting =
  | { kind: 'transcript'; old: string; since: number; identity: Identity }
  | { kind: 'answer' }

/** One reported event: its key, when it was reported and, for the first line of a pair, what it waits for. */
export interface RareRecord {
  entry: string
  event: string
  sessionId: string
  seenAt: number
  waiting?: RareWaiting
}

/** Where the records go; both calls are fire and forget (`Writes`). */
export interface RareStore {
  save(record: RareRecord): void
  prune(before: number): void
}

/** How long a key is kept: an event of a session older than this may be reported again after a restart. */
export const RARE_KEEP_MS = 30 * 24 * 3_600_000
const PRUNE_EVERY_MS = 24 * 3_600_000

const keyOf = (entry: string, event: string, sessionId: string) => JSON.stringify([entry, event, sessionId])

/**
 * The `rare:` diagnostics (BTN-718): each event is logged once, through restarts too (BTN-814). The keys and the open
 * pairs are held here and written behind to `rare_events`; a failed write only risks a repeated line.
 */
export class RareEvents {
  projectOf: (session: Identity) => string | undefined = () => undefined
  private readonly seen = new Map<string, RareRecord>()
  private readonly booting = new Map<string, RareRecord>()
  private readonly copies = new Map<string, RareRecord & { waiting: Extract<RareWaiting, { kind: 'transcript' }> }>()
  private store: RareStore = { save: () => {}, prune: () => {} }
  private prunedAt = Number.NEGATIVE_INFINITY

  constructor(private readonly log: (line: string) => void = (line) => console.log(line)) {}

  /** Takes the records kept before this start and the store for the next ones. */
  restore(records: readonly RareRecord[], store: RareStore, now = Date.now()): void {
    this.store = store
    for (const record of records) this.remember(record)
    this.prune(now)
  }

  once(entry: string, event: string, session: Identity, detail: string): boolean {
    return this.report(entry, event, session, detail, Date.now())
  }

  copy(old: string, session: Identity, since: number, transcript: boolean, now = Date.now()): void {
    if (session.sessionId === old) return
    const identity = { ...session, project: session.project ?? this.projectOf({ ...session, sessionId: old }) ?? this.projectOf(session) }
    this.report('18', `copy:${old}:${since}`, identity,
      `resume-copy oldSession=${JSON.stringify(old)} transcript=${transcript} elapsedMs=${now - since}; following the new job`,
      now, transcript ? undefined : { kind: 'transcript', old, since, identity })
  }

  observe(view: SessionView, transcript: boolean, now = Date.now()): void {
    const copy = this.copies.get(view.sessionId)
    if (copy !== undefined && transcript) {
      const { old, since, identity } = copy.waiting
      this.report('18', `transcript:${old}:${since}`, identity,
        `transcript-appeared oldSession=${JSON.stringify(old)} elapsedMs=${now - since}; following its transcript`, now)
      this.settle(copy)
    }
    if (idleBeforePrompt(view, new Date(now))) this.report('86', 'boot', view,
      `idle-before-prompt elapsedMs=${now - Date.parse(view.startedAt)}; retaining the boot grace`, now, { kind: 'answer' })
    const booting = this.booting.get(view.sessionId)
    if (booting !== undefined && view.feed.some((line) => line.kind === 'text' || line.kind === 'tool')) {
      this.report('86', 'answer', view, `first-answer elapsedMs=${now - Date.parse(view.startedAt)}; following the model response`, now)
      this.settle(booting)
    }
  }

  private report(entry: string, event: string, session: Identity, detail: string, now: number, waiting?: RareWaiting): boolean {
    if (this.seen.has(keyOf(entry, event, session.sessionId))) return false
    const project = session.project ?? this.projectOf(session) ?? 'unknown'
    const task = session.task ?? session.name ?? 'unknown'
    this.log(`rare: ${entry} project=${JSON.stringify(project)} task=${JSON.stringify(task)} session=${JSON.stringify(session.sessionId)} ${detail}`)
    this.keep({ entry, event, sessionId: session.sessionId, seenAt: now, ...(waiting === undefined ? {} : { waiting }) })
    this.prune(now)
    return true
  }

  private settle(record: RareRecord): void {
    const { waiting: _done, ...settled } = record
    this.keep(settled)
  }

  private keep(record: RareRecord): void {
    this.remember(record)
    try {
      this.store.save(record)
    } catch (error) {
      this.log(`storage: the rare event ${record.entry} not saved: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private remember(record: RareRecord): void {
    this.seen.set(keyOf(record.entry, record.event, record.sessionId), record)
    const { waiting } = record
    if (waiting?.kind === 'transcript') this.copies.set(record.sessionId, { ...record, waiting })
    else if (this.copies.get(record.sessionId)?.event === record.event) this.copies.delete(record.sessionId)
    if (waiting?.kind === 'answer') this.booting.set(record.sessionId, record)
    else if (this.booting.get(record.sessionId)?.event === record.event) this.booting.delete(record.sessionId)
  }

  private prune(now: number): void {
    if (now - this.prunedAt < PRUNE_EVERY_MS) return
    this.prunedAt = now
    const before = now - RARE_KEEP_MS
    for (const [key, record] of this.seen) {
      if (record.seenAt >= before) continue
      this.seen.delete(key)
      if (this.copies.get(record.sessionId)?.event === record.event) this.copies.delete(record.sessionId)
      if (this.booting.get(record.sessionId)?.event === record.event) this.booting.delete(record.sessionId)
    }
    try {
      this.store.prune(before)
    } catch (error) {
      this.log(`storage: the old rare events not pruned: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

export const rareEvents = new RareEvents()

/** The records kept before this start (table `rare_events`, step 34, `docs/storage.md`). */
export async function loadRareEvents(db: Queryable): Promise<RareRecord[]> {
  const { rows } = await db.query<{ entry: string; event: string; session_id: string; seen_at: string; waiting: string | null }>(
    'select entry, event, session_id, seen_at, waiting from rare_events order by seen_at, entry, event, session_id',
  )
  return rows.map((row) => ({
    entry: row.entry,
    event: row.event,
    sessionId: row.session_id,
    seenAt: Date.parse(row.seen_at),
    ...(row.waiting === null ? {} : { waiting: JSON.parse(row.waiting) as RareWaiting }),
  }))
}

/** A settled pair keeps its first `seen_at`. Starts its write at the call: see `Writes`. */
export async function saveRareEvent(db: Queryable, record: RareRecord): Promise<void> {
  await db.query(
    `insert into rare_events (entry, event, session_id, seen_at, waiting) values ($1, $2, $3, $4, $5)
       on conflict (entry, event, session_id) do update set waiting = excluded.waiting`,
    [record.entry, record.event, record.sessionId, new Date(record.seenAt).toISOString(),
      record.waiting === undefined ? null : JSON.stringify(record.waiting)],
  )
}

/** Starts its write at the call: see `Writes`. */
export async function pruneRareEvents(db: Queryable, before: number): Promise<void> {
  await db.query('delete from rare_events where seen_at < $1', [new Date(before).toISOString()])
}
