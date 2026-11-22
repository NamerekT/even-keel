import type pg from 'pg'
import { activityOf } from './activity.js'
import type { LineRow } from './parse.js'
import type { TurnEntry } from './turns.js'

type ArchivedLine = Pick<LineRow, 'uuid' | 'sessionId' | 'at' | 'raw'>

export async function writeActivity(client: pg.Client, lines: Iterable<ArchivedLine>): Promise<void> {
  const rows = []
  for (const line of lines) {
    if (line.sessionId === null) continue
    const activity = activityOf(line.raw as TurnEntry)
    if (activity !== null) rows.push({ uuid: line.uuid, session_id: line.sessionId, at: line.at, ...activity })
  }
  if (rows.length > 0) await client.query(
    `insert into session_activity (uuid, session_id, at, event, prompt)
     select * from jsonb_to_recordset($1::jsonb) as x(uuid text, session_id text, at timestamptz, event jsonb, prompt text)
     on conflict (uuid) do nothing`,
    [JSON.stringify(rows)],
  )
}

/** The cursor and the completion mark share the collector transaction. A failed backfill can be retried. */
export async function backfillActivity(client: pg.Client): Promise<void> {
  await client.query(`declare archive_activity no scroll cursor for
    select l.uuid, l.session_id as "sessionId", l.at::text, r.raw
    from lines l join line_raws r on r.uuid = l.uuid where l.session_id is not null`)
  for (;;) {
    const { rows } = await client.query<ArchivedLine>('fetch 512 from archive_activity')
    if (rows.length === 0) break
    await writeActivity(client, rows)
  }
  await client.query('close archive_activity')
}
