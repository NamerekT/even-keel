import type { LaunchEntry } from '../chain/model.js'
import { asNotice } from '../notice/notice.js'
import { relativeUnder } from '../paths.js'
import type { Queryable } from '../storage/database.js'
import { setStateValue, stateValue } from '../storage/service-state.js'
import type { EventDraft, EventEntry, EventLevel, EventPlace } from './model.js'
import { GRACE_MS, launchDraft, observe, settingsDrafts, stopDraft, watchedOf, type EventMemory, type Restored, type WatchInput } from './watch.js'

/** The entries the log keeps, the newest; a new one over it pushes out the oldest, from the database too. */
export const EVENT_LOG_LIMIT = 3000

/** Where the log's writes go: behind, in the service (`Writes`). */
export interface EventStore {
  save: (entry: EventEntry) => void
  /** Drops the entries below this id. */
  prune: (below: string) => void
  remember: (memory: EventMemory) => void
}

/**
 * The event log (BTN-350): the service looks at the state it builds for the page (`observe`) and is told of launches,
 * stops and settings, so the log fills while no page is open. `changed` — the page's state has new entries.
 */
export class EventLog {
  private readonly list: EventEntry[]
  private memory: EventMemory | null
  private readonly restored: Restored | undefined
  private settings: Record<string, unknown> | null = null

  constructor(
    loaded: { entries: EventEntry[]; memory: EventMemory | null },
    private readonly store: EventStore,
    private readonly now: () => Date = () => new Date(),
    private readonly changed: () => void = () => {},
  ) {
    this.list = [...loaded.entries]
    // Whatever held before the restart counts as seen at the start, how long the service was down says nothing, and as
    // held for `GRACE_MS` after it, while the state is read in parts.
    const start = this.now()
    const keys = Object.keys(loaded.memory?.seen ?? {})
    this.restored = loaded.memory === null ? undefined : { keys: new Set(keys), until: start.getTime() + GRACE_MS }
    this.memory = loaded.memory === null ? null : { chains: loaded.memory.chains, seen: Object.fromEntries(keys.map((key) => [key, start.toISOString()])), gone: {} }
  }

  get entries(): readonly EventEntry[] {
    return this.list
  }

  add(draft: EventDraft): void {
    const last = this.list.at(-1)
    const entry: EventEntry = { id: String(last === undefined ? 1 : Number(last.id) + 1), at: this.now().toISOString(), ...draft }
    this.list.push(entry)
    this.store.save(entry)
    if (this.list.length > EVENT_LOG_LIMIT) {
      this.list.splice(0, this.list.length - EVENT_LOG_LIMIT)
      this.store.prune(this.list[0]!.id)
    }
    this.changed()
  }

  observe(state: WatchInput): void {
    const step = observe(this.memory, watchedOf(state, relativeUnder), this.now(), this.restored)
    this.memory = step.memory
    if (step.changed) this.store.remember(step.memory)
    for (const draft of step.drafts) this.add(draft)
  }

  /** The settings in the shape of the config file (`ConfigStore.raw`); the first ones are only remembered. */
  settingsSeen(raw: Record<string, unknown>): void {
    const before = this.settings
    this.settings = raw
    if (before !== null) for (const draft of settingsDrafts(before, raw)) this.add(draft)
  }

  launched(entry: LaunchEntry): void {
    const draft = launchDraft(entry)
    if (draft !== null) this.add(draft)
  }

  stopped(project: string, task: string): void {
    this.add(stopDraft(project, task))
  }
}

export async function loadEventLog(db: Queryable): Promise<{ entries: EventEntry[]; memory: EventMemory | null }> {
  const { rows } = await db.query<{ id: number; at: string; level: EventLevel; notice: string; place: string | null }>(
    'select id, at, level, notice, place from event_log order by id desc limit $1',
    [EVENT_LOG_LIMIT],
  )
  const entries = rows.reverse().map((row) => ({
    id: String(row.id),
    at: row.at,
    level: row.level,
    notice: asNotice(JSON.parse(row.notice)),
    place: row.place === null ? null : (JSON.parse(row.place) as EventPlace),
  }))
  const memory = (await stateValue(db, 'eventLog.memory')) as EventMemory | undefined
  return { entries, memory: memory ?? null }
}

/** Starts its write at the call: see `Writes`. */
export async function saveEventEntry(db: Queryable, entry: EventEntry): Promise<void> {
  await db.query('insert into event_log (id, at, level, notice, place) values ($1, $2, $3, $4, $5)', [
    Number(entry.id),
    entry.at,
    entry.level,
    JSON.stringify(entry.notice),
    entry.place === null ? null : JSON.stringify(entry.place),
  ])
}

export async function pruneEventLog(db: Queryable, below: string): Promise<void> {
  await db.query('delete from event_log where id < $1', [Number(below)])
}

export async function saveEventMemory(db: Queryable, memory: EventMemory): Promise<void> {
  await setStateValue(db, 'eventLog.memory', memory)
}
