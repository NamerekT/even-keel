import pg from 'pg'
import { stat } from 'node:fs/promises'
import type { TaskSource } from '../../src/chain/launches.js'
import type { Entry } from '../../src/sessions/entry.js'
import type { ClosedState } from './closed-tasks.js'
import type { ClassifySettings, DbSettings, Price } from './config.js'
import type { Snapshot } from './limits.js'
import type { FileState, Store } from './load.js'
import type { TaskRecord, TimeReport } from './huly.js'
import type { Batch, Launch, MessageRow } from './parse.js'
import type { RuleChange, VersionSource } from './rule-changes.js'
import type { ImportRow } from './rule-imports.js'
import type { RuleRows } from './rule-parse.js'
import type { Sign, SignKind, Span } from './signs.js'
import type { StepRun } from './step-runs.js'
import type { TranscriptEntry } from './stream.js'
import type { Turn } from './turns.js'
import { cleanText } from './compact.js'
import type { HandoffRow } from './handoffs.js'
import { migrate, pgDb, type Migration } from './migrations.js'
import { firstPrompt } from './prompt.js'

export interface PendingSpan {
  id: string
  sessionId: string
  agentId: string | null
  fromAt: string
  toAt: string
  kinds: SignKind[]
  task: string | null
  signs: string[]
}

export interface SpanReason {
  reason: string
  note: string
  promptVersion: number
  model: string | null
  classifierSession: string | null
}

export interface SignState {
  sessionId: string
  lastAt: string | null
  launchReason: string | null
  signedAt: string | null
  key: string | null
}

export interface SnapshotFile {
  path: string
  key: string
  size: number
  mtime: string
  hash: string | null
}

export interface KeyVersion {
  key: string
  hash: string | null
  at: string
  source?: VersionSource
}

export interface StoredChange extends RuleChange {
  id: string
  added: number
  removed: number
}

// $1 — `ClosedState[]`: a done task keeps its status when the archive has none, an open one drops it (BTN-330).
export const CLOSED_TASK_STATES = `
insert into tasks (task, status, done, fetched_at)
select x.task, x.status, x.done, 'epoch' from jsonb_to_recordset($1::jsonb) as x(task text, status text, done boolean)
on conflict (task) do update set
  status = case when excluded.done then coalesce(excluded.status, tasks.status) end, done = excluded.done
where tasks.done is distinct from excluded.done
  or tasks.status is distinct from case when excluded.done then coalesce(excluded.status, tasks.status) end`

export const SESSION_FOLDERS = `
update sessions s set project_dir = (
  select m.project_dir from messages m
  where m.session_id = s.session_id and m.project_dir is not null
  order by m.at, m.message_id
  limit 1
)
where s.project_dir is null
  and exists (select 1 from messages m where m.session_id = s.session_id and m.project_dir is not null)`
// Messages loaded before effort was parsed take it from their stored lines; run once (tally_meta 'efforts').
export const MESSAGE_EFFORTS = `
update messages m set effort = e.effort
from (
  select distinct on (raw->'message'->>'id') raw->'message'->>'id' as message_id, raw->>'effort' as effort
  from lines
  where type = 'assistant' and raw->>'effort' is not null
  order by raw->'message'->>'id', at desc
) e
where e.message_id = m.message_id and m.effort is null`
// Only rows that can be a prompt: the rest of a session's user rows are tool results, heavy to fetch.
export const SESSION_PROMPT_ROWS = `
select s.session_id, coalesce(s.last_at < now() - interval '1 day', false) as old,
  (select coalesce(jsonb_agg(p.raw order by p.at, p.uuid), '[]'::jsonb)
   from (
     select l.raw, l.at, l.uuid from lines l
     where l.session_id = s.session_id and l.agent_id is null and l.type = 'user'
       and coalesce(l.raw->>'isMeta', '') <> 'true'
       and (jsonb_typeof(l.raw->'message'->'content') = 'string'
         or not (l.raw->'message'->'content') @> '[{"type": "tool_result"}]')
     order by l.at, l.uuid
     limit 10
   ) p) as rows
from sessions s
where s.prompt is null`
const LOCK_KEY = 'tally-collector'

export class TallyDb implements Store {
  private constructor(private readonly client: pg.Client) {}

  static async connect(settings: DbSettings): Promise<TallyDb> {
    const client = new pg.Client({ ...settings, connectionTimeoutMillis: 15_000 })
    await client.connect()
    return new TallyDb(client)
  }

  async lock(): Promise<boolean> {
    const result = await this.client.query<{ locked: boolean }>('select pg_try_advisory_lock(hashtext($1)) as locked', [LOCK_KEY])
    return result.rows[0]?.locked === true
  }

  migrate(): Promise<Migration> {
    return migrate(pgDb(this.client))
  }

  async files(): Promise<Map<string, FileState>> {
    const result = await this.client.query(
      `select path, account, read_to, size, mtime, ino, head, head_len from files`,
    )
    return new Map(
      result.rows.map((row) => [
        row.path,
        {
          path: row.path,
          account: row.account,
          offset: Number(row.read_to),
          size: Number(row.size),
          mtime: (row.mtime as Date).toISOString(),
          ino: row.ino,
          head: row.head,
          headLen: row.head_len,
        },
      ]),
    )
  }

  async write(batch: Batch, file: FileState): Promise<void> {
    await this.transaction(async () => {
      await this.upsert(
        `insert into lines (uuid, session_id, agent_id, type, at, raw)
         select uuid, session_id, agent_id, type, at, raw
         from jsonb_to_recordset($1::jsonb) as x(uuid text, session_id text, agent_id text, type text, at timestamptz, raw jsonb)
         on conflict (uuid) do nothing`,
        batch.lines,
      )
      await this.upsert(
        `insert into messages
         select * from jsonb_to_recordset($1::jsonb) as x(
           message_id text, session_id text, agent_id text, account text, project text, project_dir text, task text,
           branch text, entrypoint text, model text, speed text, at timestamptz,
           input bigint, cache_write_5m bigint, cache_write_1h bigint, cache_read bigint, output bigint, effort text)
         on conflict (message_id) do update set
           at = least(messages.at, excluded.at),
           input = greatest(messages.input, excluded.input),
           cache_write_5m = greatest(messages.cache_write_5m, excluded.cache_write_5m),
           cache_write_1h = greatest(messages.cache_write_1h, excluded.cache_write_1h),
           cache_read = greatest(messages.cache_read, excluded.cache_read),
           output = greatest(messages.output, excluded.output),
           speed = coalesce(excluded.speed, messages.speed),
           effort = coalesce(excluded.effort, messages.effort)`,
        batch.messages,
      )
      await this.upsert(
        `insert into tool_calls (tool_use_id, session_id, message_id, task, name, input_hash, brief, at)
         select * from jsonb_to_recordset($1::jsonb) as x(
           tool_use_id text, session_id text, message_id text, task text, name text, input_hash text, brief text, at timestamptz)
         on conflict (tool_use_id) do update set
           session_id = coalesce(tool_calls.session_id, excluded.session_id),
           message_id = coalesce(tool_calls.message_id, excluded.message_id),
           task = coalesce(tool_calls.task, excluded.task),
           name = excluded.name, input_hash = excluded.input_hash, brief = excluded.brief,
           at = least(tool_calls.at, excluded.at)`,
        batch.calls,
      )
      await this.upsert(
        `insert into tool_calls (tool_use_id, result_at, is_error, error_kind, error_text)
         select * from jsonb_to_recordset($1::jsonb) as x(
           tool_use_id text, result_at timestamptz, is_error boolean, error_kind text, error_text text)
         on conflict (tool_use_id) do update set
           result_at = excluded.result_at, is_error = excluded.is_error,
           error_kind = excluded.error_kind, error_text = excluded.error_text`,
        batch.results,
      )
      await this.upsert(
        `insert into sessions
         select * from jsonb_to_recordset($1::jsonb) as x(
           session_id text, account text, project text, custom_title text, ai_title text,
           launch_task text, launch_reason text, first_at timestamptz, last_at timestamptz)
         on conflict (session_id) do update set
           project = coalesce(sessions.project, excluded.project),
           custom_title = coalesce(excluded.custom_title, sessions.custom_title),
           ai_title = coalesce(excluded.ai_title, sessions.ai_title),
           launch_task = coalesce(excluded.launch_task, sessions.launch_task),
           launch_reason = coalesce(excluded.launch_reason, sessions.launch_reason),
           first_at = least(sessions.first_at, excluded.first_at),
           last_at = greatest(sessions.last_at, excluded.last_at)`,
        batch.sessions,
      )
      await this.writeRuleRows(batch)
      await this.client.query(
        `insert into files (path, account, read_to, size, mtime, ino, head, head_len, read_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now())
         on conflict (path) do update set
           account = excluded.account, read_to = excluded.read_to, size = excluded.size, mtime = excluded.mtime,
           ino = excluded.ino, head = excluded.head, head_len = excluded.head_len, read_at = excluded.read_at`,
        [file.path, file.account, file.offset, file.size, file.mtime, file.ino, file.head, file.headLen],
      )
    })
  }

  async writeRules(rows: RuleRows): Promise<void> {
    await this.transaction(() => this.writeRuleRows(rows))
  }

  private async writeRuleRows(rows: RuleRows): Promise<void> {
    await this.upsert(
      `insert into rule_texts select * from jsonb_to_recordset($1::jsonb) as x(hash text, content text, lines int)
       on conflict (hash) do nothing`,
      rows.ruleTexts,
    )
    await this.upsert(
      `insert into rule_files select * from jsonb_to_recordset($1::jsonb) as x(key text, display text, kind text, scope text)
       on conflict (key) do nothing`,
      rows.ruleFiles,
    )
    await this.upsert(
      `insert into rule_seen select * from jsonb_to_recordset($1::jsonb) as x(session_id text, key text, hash text, at timestamptz)
       on conflict (session_id, key, hash) do update set at = least(rule_seen.at, excluded.at)`,
      rows.ruleSeen,
    )
    await this.upsert(
      `insert into rule_edits select * from jsonb_to_recordset($1::jsonb) as x(
         tool_use_id text, session_id text, agent_id text, key text, at timestamptz, tool text, added int, removed int)
       on conflict (tool_use_id) do nothing`,
      rows.ruleEdits,
    )
    await this.upsert(
      `insert into rule_versions select * from jsonb_to_recordset($1::jsonb) as x(key text, at timestamptz, hash text, source text, ref text)
       on conflict do nothing`,
      rows.ruleVersions,
    )
  }

  // rule_files goes too, so git is read again from the start: it re-adds its files on the same run, as backups do.
  async forgetTranscriptRules(): Promise<void> {
    await this.transaction(async () => {
      await this.client.query('truncate rule_seen, rule_edits, rule_files, rule_changes')
      await this.client.query(`delete from rule_versions where source = 'file-history'`)
      await this.client.query(`delete from tally_meta where name like 'rules_git:%'`)
    })
  }

  async meta(name: string): Promise<string | null> {
    const result = await this.client.query<{ value: string }>('select value from tally_meta where name = $1', [name])
    return result.rows[0]?.value ?? null
  }

  async setMeta(name: string, value: string): Promise<void> {
    await this.client.query(
      'insert into tally_meta (name, value) values ($1, $2) on conflict (name) do update set value = excluded.value',
      [name, value],
    )
  }

  async snapshotFiles(): Promise<Map<string, SnapshotFile>> {
    const result = await this.client.query('select path, key, size, mtime, hash from rule_snapshot_files')
    return new Map(result.rows.map((row) => [row.path, { path: row.path, key: row.key, size: Number(row.size), mtime: row.mtime, hash: row.hash }]))
  }

  async lastSnapshots(): Promise<Map<string, string | null>> {
    const result = await this.client.query('select distinct on (key) key, hash from rule_snapshots order by key, at desc')
    return new Map(result.rows.map((row) => [row.key, row.hash]))
  }

  async writeSnapshots(rows: RuleRows, files: SnapshotFile[], snapshots: { key: string; at: string; hash: string | null }[]): Promise<void> {
    await this.transaction(async () => {
      await this.writeRuleRows(rows)
      await this.client.query('delete from rule_snapshot_files')
      await this.upsert(
        `insert into rule_snapshot_files select * from jsonb_to_recordset($1::jsonb) as x(path text, key text, size bigint, mtime text, hash text)`,
        files,
      )
      await this.upsert(
        `insert into rule_snapshots select * from jsonb_to_recordset($1::jsonb) as x(key text, at timestamptz, hash text)
         on conflict do nothing`,
        snapshots,
      )
    })
  }

  // A version found in several places counts from its earliest sighting, with that place as its source.
  async ruleVersions(): Promise<{ seen: KeyVersion[]; snapshots: KeyVersion[] }> {
    const [seen, snapshots] = await Promise.all([
      this.client.query(
        `select distinct on (key, hash) key, hash, at, source from (
           select key, hash, at, null as source from rule_seen
           union all select key, hash, at, source from rule_versions
         ) v order by key, hash, at, source nulls first`,
      ),
      this.client.query('select key, hash, at from rule_snapshots'),
    ])
    const map = (row: Record<string, unknown>): KeyVersion => ({
      key: row.key as string,
      hash: row.hash as string | null,
      at: (row.at as Date).toISOString(),
      ...(row.source ? { source: row.source as VersionSource } : {}),
    })
    return { seen: seen.rows.map(map), snapshots: snapshots.rows.map(map) }
  }

  async ruleChangeIds(): Promise<Set<string>> {
    const result = await this.client.query<{ id: string }>('select id from rule_changes')
    return new Set(result.rows.map((row) => row.id))
  }

  async ruleTextsOf(hashes: string[]): Promise<Map<string, string>> {
    const result = await this.client.query<{ hash: string; content: string }>('select hash, content from rule_texts where hash = any($1::text[])', [hashes])
    return new Map(result.rows.map((row) => [row.hash, row.content]))
  }

  async writeRuleChanges(added: StoredChange[], removed: string[]): Promise<void> {
    await this.transaction(async () => {
      if (removed.length > 0) await this.client.query('delete from rule_changes where id = any($1::text[])', [removed])
      await this.upsert(
        `insert into rule_changes select * from jsonb_to_recordset($1::jsonb) as x(
           id text, key text, at timestamptz, old_hash text, new_hash text, source text, added int, removed int)
         on conflict (id) do nothing`,
        added,
      )
    })
  }

  // The import file is the truth: lines gone from it leave the table.
  async syncImports(rows: ImportRow[]): Promise<{ added: number; removed: number }> {
    let added = 0
    let removed = 0
    await this.transaction(async () => {
      const gone = await this.client.query('delete from rule_imports where not (hash = any($1::text[]))', [rows.map((row) => row.hash)])
      removed = gone.rowCount ?? 0
      const list = rows.map(snake)
      if (list.length === 0) return
      const result = await this.client.query(
        `insert into rule_imports select * from jsonb_to_recordset($1::jsonb) as x(
           hash text, id text, at timestamptz, until timestamptz, precision text, sessions text[], files jsonb,
           purpose text[], reason text, task text, source text)
         on conflict (hash) do nothing`,
        [JSON.stringify(list)],
      )
      added = result.rowCount ?? 0
    })
    return { added, removed }
  }

  async forgetFilesExcept(paths: string[]): Promise<number> {
    const candidates = await this.client.query<{ path: string }>('select path from files where not (path = any($1::text[]))', [paths])
    const missing: string[] = []
    for (const { path } of candidates.rows) {
      try {
        await stat(path)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'ENOTDIR') missing.push(path)
      }
    }
    if (missing.length === 0) return 0
    const result = await this.client.query('delete from files where path = any($1::text[])', [missing])
    return result.rowCount ?? 0
  }

  async syncLaunches(launches: ReadonlyMap<string, Launch>): Promise<number> {
    const rows = [...launches].map(([session_id, launch]) => ({ session_id, task: launch.task, reason: launch.reason }))
    const result = await this.client.query(
      `update sessions s set launch_task = x.task, launch_reason = x.reason
       from jsonb_to_recordset($1::jsonb) as x(session_id text, task text, reason text)
       where s.session_id = x.session_id
         and (s.launch_task is distinct from x.task or s.launch_reason is distinct from x.reason)`,
      [JSON.stringify(rows)],
    )
    return result.rowCount ?? 0
  }

  /**
   * A task's profile and link from Even Keel's launch log (BTN-66), and its title while no tracker gave one: a task of
   * another tracker than Huly is never asked. A new row is stale at once, so Huly is asked for its own tasks.
   */
  async syncTaskSources(sources: TaskSource[]): Promise<number> {
    const result = await this.client.query(
      `insert into tasks (task, title, profile_id, url, fetched_at)
       select task, title, profile, url, 'epoch' from jsonb_to_recordset($1::jsonb) as x(task text, title text, profile text, url text)
       on conflict (task) do update set
         profile_id = coalesce(excluded.profile_id, tasks.profile_id), url = coalesce(excluded.url, tasks.url),
         title = case when coalesce(tasks.title, '') = '' then excluded.title else tasks.title end
       where tasks.profile_id is distinct from coalesce(excluded.profile_id, tasks.profile_id)
         or tasks.url is distinct from coalesce(excluded.url, tasks.url)
         or (coalesce(tasks.title, '') = '' and excluded.title is not null)`,
      [JSON.stringify(sources)],
    )
    return result.rowCount ?? 0
  }

  /** The status and the done mark of tasks of other trackers than Huly, from Even Keel's archive (`closedStates`). */
  async syncClosedTasks(states: ClosedState[]): Promise<number> {
    const result = await this.client.query(CLOSED_TASK_STATES, [JSON.stringify(states)])
    return result.rowCount ?? 0
  }

  async fillEfforts(): Promise<number> {
    const result = await this.client.query(MESSAGE_EFFORTS)
    return result.rowCount ?? 0
  }

  async fillSessionFolders(): Promise<number> {
    const result = await this.client.query(SESSION_FOLDERS)
    return result.rowCount ?? 0
  }

  async handoffSources(): Promise<Map<string, string>> {
    const result = await this.client.query<{ session_id: string; source: string }>('select session_id, source from handoffs')
    return new Map(result.rows.map((row) => [row.session_id, row.source]))
  }

  /** A snapshot replaces a row rebuilt from transcripts, never the other way round. */
  async addHandoffs(rows: HandoffRow[]): Promise<number> {
    const result = await this.client.query(
      `insert into handoffs (session_id, previous, task, reason, at, source, prompt, note_path, note)
       select x."sessionId", x.previous, x.task, x.reason, nullif(x.at, '')::timestamptz, x.source, x.prompt, x."notePath", x.note
       from jsonb_to_recordset($1::jsonb) as x(
         "sessionId" text, previous text, task text, reason text, at text, source text, prompt text, "notePath" text, note text)
       on conflict (session_id) do update set
         previous = excluded.previous, task = excluded.task, reason = excluded.reason, at = excluded.at, source = excluded.source,
         prompt = excluded.prompt, note_path = excluded.note_path, note = excluded.note
       where handoffs.source <> 'even-keel'`,
      [JSON.stringify(rows.map((row) => ({ ...row, prompt: cleanText(row.prompt), note: row.note === null ? null : cleanText(row.note) })))],
    )
    return result.rowCount ?? 0
  }

  /** The first prompt of sessions without one; a session that has none a day after its last row gets '' and is not read again. */
  async fillPrompts(): Promise<number> {
    const result = await this.client.query<{ session_id: string; old: boolean; rows: Entry[] }>(SESSION_PROMPT_ROWS)
    const rows = result.rows.flatMap((row) => {
      const prompt = firstPrompt(row.rows)
      return prompt !== null || row.old ? [{ session_id: row.session_id, prompt: prompt ?? '' }] : []
    })
    if (rows.length === 0) return 0
    const updated = await this.client.query(
      `update sessions s set prompt = x.prompt
       from jsonb_to_recordset($1::jsonb) as x(session_id text, prompt text)
       where s.session_id = x.session_id`,
      [JSON.stringify(rows)],
    )
    return updated.rowCount ?? 0
  }

  async syncPrices(prices: Price[]): Promise<void> {
    await this.transaction(async () => {
      await this.client.query('delete from model_prices where not (model = any($1::text[]))', [prices.map((price) => price.model)])
      await this.upsert(
        `insert into model_prices (model, input, output, cache_read, cache_write_5m, cache_write_1h,
           long_over, long_input, long_output, long_cache_read, long_cache_write_5m, long_cache_write_1h)
         select * from jsonb_to_recordset($1::jsonb) as x(
           model text, input numeric, output numeric, cache_read numeric, cache_write_5m numeric, cache_write_1h numeric,
           long_over bigint, long_input numeric, long_output numeric, long_cache_read numeric,
           long_cache_write_5m numeric, long_cache_write_1h numeric)
         on conflict (model) do update set
           input = excluded.input, output = excluded.output, cache_read = excluded.cache_read,
           cache_write_5m = excluded.cache_write_5m, cache_write_1h = excluded.cache_write_1h,
           long_over = excluded.long_over, long_input = excluded.long_input, long_output = excluded.long_output,
           long_cache_read = excluded.long_cache_read, long_cache_write_5m = excluded.long_cache_write_5m,
           long_cache_write_1h = excluded.long_cache_write_1h`,
        prices.map(({ longPrompt, ...price }) => ({
          ...price,
          longOver: longPrompt?.over ?? null,
          longInput: longPrompt?.input ?? null,
          longOutput: longPrompt?.output ?? null,
          longCacheRead: longPrompt?.cacheRead ?? null,
          longCacheWrite5m: longPrompt?.cacheWrite5m ?? null,
          longCacheWrite1h: longPrompt?.cacheWrite1h ?? null,
        })),
      )
    })
  }

  async addSnapshots(snapshots: Snapshot[]): Promise<number> {
    const result = await this.client.query(
      `insert into limit_snapshots (account, span, observed_at, used_percentage, resets_at, source)
       select account, "window", observed_at, used_percentage, resets_at, source
       from jsonb_to_recordset($1::jsonb) as x(
         account text, "window" text, observed_at timestamptz, used_percentage real, resets_at timestamptz, source text)
       on conflict do nothing`,
      [JSON.stringify(snapshots.map(snake))],
    )
    return result.rowCount ?? 0
  }

  async unpricedModels(): Promise<string[]> {
    const result = await this.client.query<{ model: string }>(
      `select distinct model from message_costs where price_model is null and model is not null order by model`,
    )
    return result.rows.map((row) => row.model)
  }

  async signStates(): Promise<SignState[]> {
    const result = await this.client.query(
      `select s.session_id, s.last_at, s.launch_reason, g.last_at as signed_at, g.key
       from sessions s left join sign_sessions g on g.session_id = s.session_id`,
    )
    return result.rows.map((row) => ({
      sessionId: row.session_id,
      lastAt: (row.last_at as Date | null)?.toISOString() ?? null,
      launchReason: row.launch_reason,
      signedAt: (row.signed_at as Date | null)?.toISOString() ?? null,
      key: row.key,
    }))
  }

  async sessionEntries(sessionId: string): Promise<TranscriptEntry[]> {
    const result = await this.client.query<{ raw: TranscriptEntry }>(
      'select raw from lines where session_id = $1 order by at, uuid',
      [sessionId],
    )
    return result.rows.map((row) => row.raw)
  }

  async writeSigns(sessionId: string, lastAt: string | null, key: string, signs: Sign[], spans: Span[]): Promise<void> {
    await this.transaction(async () => {
      await this.client.query('delete from signs where session_id = $1', [sessionId])
      await this.client.query('delete from spans where session_id = $1', [sessionId])
      await this.upsert(
        `insert into signs
         select * from jsonb_to_recordset($1::jsonb) as x(
           session_id text, agent_id text, kind text, from_uuid text, to_uuid text,
           from_at timestamptz, to_at timestamptz, count int, detail text)
         on conflict do nothing`,
        signs.map((sign) => ({ sessionId, ...sign, agentId: sign.agentId ?? '' })),
      )
      await this.upsert(
        `insert into spans
         select id, session_id, agent_id, from_uuid, to_uuid, from_at, to_at,
           array(select jsonb_array_elements_text(kinds))
         from jsonb_to_recordset($1::jsonb) as x(
           id text, session_id text, agent_id text, from_uuid text, to_uuid text,
           from_at timestamptz, to_at timestamptz, kinds jsonb)
         on conflict (id) do nothing`,
        spans.map((span) => ({ ...span, agentId: span.agentId ?? '' })),
      )
      await this.client.query(
        `insert into sign_sessions (session_id, last_at, key) values ($1, $2, $3)
         on conflict (session_id) do update set last_at = excluded.last_at, key = excluded.key`,
        [sessionId, lastAt, key],
      )
    })
  }

  async turnStates(): Promise<SignState[]> {
    const result = await this.client.query(
      `select s.session_id, s.last_at, s.launch_reason, g.last_at as signed_at, g.key
       from sessions s left join turn_sessions g on g.session_id = s.session_id`,
    )
    return result.rows.map((row) => ({
      sessionId: row.session_id,
      lastAt: (row.last_at as Date | null)?.toISOString() ?? null,
      launchReason: row.launch_reason,
      signedAt: (row.signed_at as Date | null)?.toISOString() ?? null,
      key: row.key,
    }))
  }

  async writeTurns(sessionId: string, lastAt: string | null, key: string, turns: Turn[]): Promise<void> {
    await this.transaction(async () => {
      await this.client.query('delete from turns where session_id = $1', [sessionId])
      await this.upsert(
        `insert into turns (session_id, start_uuid, start, started_at, ended_at, replies, ask_s, limited, cli_s)
         select session_id, start_uuid, start, started_at, ended_at, replies, ask_seconds, limited, cli_seconds
         from jsonb_to_recordset($1::jsonb) as x(
           session_id text, start_uuid text, start text, started_at timestamptz, ended_at timestamptz,
           replies int, ask_seconds numeric, limited boolean, cli_seconds numeric)
         on conflict do nothing`,
        turns.map((turn) => ({ sessionId, ...turn })),
      )
      await this.client.query(
        `insert into turn_sessions (session_id, last_at, key) values ($1, $2, $3)
         on conflict (session_id) do update set last_at = excluded.last_at, key = excluded.key`,
        [sessionId, lastAt, key],
      )
    })
  }

  async stepStates(): Promise<(SignState & { project: string | null })[]> {
    const result = await this.client.query(
      `select s.session_id, s.last_at, s.launch_reason, s.project, g.last_at as signed_at, g.key
       from sessions s left join step_sessions g on g.session_id = s.session_id`,
    )
    return result.rows.map((row) => ({
      sessionId: row.session_id,
      lastAt: (row.last_at as Date | null)?.toISOString() ?? null,
      launchReason: row.launch_reason,
      project: row.project,
      signedAt: (row.signed_at as Date | null)?.toISOString() ?? null,
      key: row.key,
    }))
  }

  async writeSteps(sessionId: string, lastAt: string | null, key: string, runs: StepRun[]): Promise<void> {
    await this.transaction(async () => {
      await this.client.query('delete from step_runs where session_id = $1', [sessionId])
      await this.upsert(
        `insert into step_runs (tool_use_id, session_id, agent_id, step, signature, command, started_at, ended_at, seconds,
           mode, end_by, outcome, place, polls)
         select tool_use_id, session_id, agent_id, step, signature, command, started_at, ended_at, seconds,
           mode, end_by, outcome, place, polls
         from jsonb_to_recordset($1::jsonb) as x(
           tool_use_id text, session_id text, agent_id text, step text, signature text, command text,
           started_at timestamptz, ended_at timestamptz, seconds numeric, mode text, end_by text, outcome text,
           place text, polls int)
         on conflict (tool_use_id) do nothing`,
        runs.map((run) => ({ sessionId, ...run, agentId: run.agentId ?? '' })),
      )
      await this.client.query(
        `insert into step_sessions (session_id, last_at, key) values ($1, $2, $3)
         on conflict (session_id) do update set last_at = excluded.last_at, key = excluded.key`,
        [sessionId, lastAt, key],
      )
    })
  }

  async staleTasks(maxAgeMinutes: number): Promise<string[]> {
    const result = await this.client.query<{ task: string }>(
      `select distinct st.task from session_tasks st left join tasks t on t.task = st.task
       where st.task is not null
         and (t.task is null or t.fetched_at < now() - make_interval(mins => $1) or (t.title is not null and t.priority is null))
       order by st.task`,
      [maxAgeMinutes],
    )
    return result.rows.map((row) => row.task)
  }

  async writeTasks(asked: string[], records: TaskRecord[]): Promise<void> {
    const found = new Set(records.map((record) => record.task))
    const missing = asked
      .filter((task) => !found.has(task))
      .map((task) => ({
        task, title: null, status: null, labels: [], related: [], priority: null, estimateH: null, component: null, milestone: null, done: null, createdAt: null,
      }))
    await this.upsert(
      `insert into tasks (task, title, status, labels, related, priority, estimate_h, component, milestone, done, created_at, fetched_at)
       select task, title, status, array(select jsonb_array_elements_text(labels)), array(select jsonb_array_elements_text(related)),
         priority, estimate_h, component, milestone, done, created_at, now()
       from jsonb_to_recordset($1::jsonb) as x(
         task text, title text, status text, labels jsonb, related jsonb, priority text, estimate_h numeric, component text, milestone text, done boolean,
         created_at timestamptz)
       on conflict (task) do update set
         title = coalesce(excluded.title, tasks.title), status = coalesce(excluded.status, tasks.status),
         labels = case when excluded.title is null then tasks.labels else excluded.labels end,
         related = case when excluded.title is null then tasks.related else excluded.related end,
         priority = case when excluded.title is null then tasks.priority else excluded.priority end,
         estimate_h = case when excluded.title is null then tasks.estimate_h else excluded.estimate_h end,
         component = case when excluded.title is null then tasks.component else excluded.component end,
         milestone = case when excluded.title is null then tasks.milestone else excluded.milestone end,
         done = case when excluded.title is null then tasks.done else excluded.done end,
         created_at = coalesce(excluded.created_at, tasks.created_at),
         fetched_at = excluded.fetched_at`,
      [...records, ...missing],
    )
  }

  async pendingReports(since: string, idleMinutes: number): Promise<TimeReport[]> {
    const result = await this.client.query(
      `select t.task, round(tt.active_s / 3600, 2) as hours, tt.last_at
       from tasks t join task_times tt on tt.task = t.task
       where t.done and t.reported_at is null and tt.active_s >= 60
         and tt.first_at >= $1::date and tt.last_at < now() - make_interval(mins => $2)
       order by tt.last_at`,
      [since, idleMinutes],
    )
    return result.rows.map((row) => ({ task: row.task, hours: Number(row.hours), date: (row.last_at as Date).toISOString() }))
  }

  async markReported(reported: ReadonlyMap<string, number>): Promise<void> {
    await this.client.query(
      `update tasks t set reported_h = x.hours, reported_at = now()
       from jsonb_to_recordset($1::jsonb) as x(task text, hours numeric)
       where t.task = x.task`,
      [JSON.stringify([...reported].map(([task, hours]) => ({ task, hours })))],
    )
  }

  async pendingSpans(settings: ClassifySettings): Promise<PendingSpan[]> {
    const result = await this.client.query(
      `select sp.id, sp.session_id, sp.agent_id, sp.from_at, sp.to_at, sp.kinds, st.task,
         array(
           select g.kind || ' ×' || g.count || coalesce(': ' || nullif(g.detail, ''), '') from signs g
           where g.session_id = sp.session_id and g.agent_id = sp.agent_id and g.from_at between sp.from_at and sp.to_at
           order by g.from_at
         ) as signs
       from spans sp
       join sessions s on s.session_id = sp.session_id
       left join session_tasks st on st.session_id = sp.session_id
       where not exists (select 1 from span_reasons r where r.span_id = sp.id)
         and s.last_at < now() - make_interval(mins => $1)
         and s.last_at > now() - make_interval(days => $2)
       order by sp.to_at desc
       limit $3`,
      [settings.idleMinutes, settings.sinceDays, settings.perRun],
    )
    return result.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      agentId: row.agent_id === '' ? null : row.agent_id,
      fromAt: (row.from_at as Date).toISOString(),
      toAt: (row.to_at as Date).toISOString(),
      kinds: row.kinds,
      task: row.task,
      signs: row.signs,
    }))
  }

  async writeReason(span: PendingSpan, reason: SpanReason, costs: MessageRow[]): Promise<void> {
    await this.transaction(async () => {
      await this.client.query(
        `insert into span_reasons (span_id, session_id, agent_id, from_at, to_at, kinds, reason, note, prompt_version, model, classifier_session)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (span_id) do nothing`,
        [span.id, span.sessionId, span.agentId ?? '', span.fromAt, span.toAt, span.kinds,
          reason.reason, reason.note, reason.promptVersion, reason.model, reason.classifierSession],
      )
      await this.upsert(
        `insert into messages
         select * from jsonb_to_recordset($1::jsonb) as x(
           message_id text, session_id text, agent_id text, account text, project text, project_dir text, task text,
           branch text, entrypoint text, model text, speed text, at timestamptz,
           input bigint, cache_write_5m bigint, cache_write_1h bigint, cache_read bigint, output bigint, effort text)
         on conflict (message_id) do nothing`,
        costs,
      )
    })
  }

  async close(): Promise<void> {
    await this.client.end()
  }

  private async upsert(sql: string, rows: Map<string, object> | object[]): Promise<void> {
    const list = Array.isArray(rows) ? rows : [...rows.values()]
    if (list.length === 0) return
    await this.client.query(sql, [JSON.stringify(list.map(snake))])
  }

  private async transaction(work: () => Promise<void>): Promise<void> {
    await this.client.query('begin')
    try {
      await work()
      await this.client.query('commit')
    } catch (error) {
      await this.client.query('rollback')
      throw error
    }
  }
}

function snake(row: object): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    result[key.replace(/([a-z])([A-Z0-9])/g, '$1_$2').toLowerCase()] = value
  }
  return result
}
