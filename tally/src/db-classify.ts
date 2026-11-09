import type pg from 'pg'
import type { ClassifySettings } from './config.js'
import type { SignKind } from './signs.js'
import type { MessageRow } from './parse.js'

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

export async function pendingSpans(client: pg.Client, settings: ClassifySettings): Promise<PendingSpan[]> {
  const result = await client.query(
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

export async function writeReason(client: pg.Client, transaction: (work: () => Promise<void>) => Promise<void>, upsert: (sql: string, rows: MessageRow[]) => Promise<void>, span: PendingSpan, reason: SpanReason, costs: MessageRow[]): Promise<void> {
  await transaction(async () => {
    await client.query(
      `insert into span_reasons (span_id, session_id, agent_id, from_at, to_at, kinds, reason, note, prompt_version, model, classifier_session)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (span_id) do nothing`,
      [span.id, span.sessionId, span.agentId ?? '', span.fromAt, span.toAt, span.kinds,
        reason.reason, reason.note, reason.promptVersion, reason.model, reason.classifierSession],
    )
    await upsert(
      `insert into messages
       select * from jsonb_to_recordset($1::jsonb) as x(
         message_id text, session_id text, agent_id text, account text, project text, project_dir text, task text,
         branch text, entrypoint text, model text, speed text, at timestamptz,
         input bigint, cache_write_5m bigint, cache_write_1h bigint, cache_read bigint, output bigint, effort text, provider text)
       on conflict (message_id) do nothing`,
      costs,
    )
  })
}
