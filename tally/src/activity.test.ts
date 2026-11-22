import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { expect, it } from 'vitest'
import { activityOf } from './activity.js'
import { excerptOf } from './classify.js'
import { TallyDb } from './db.js'
import { openLocalTally } from './local.js'
import { type LineRow } from './parse.js'
import { DEFAULT_SIGN_RULES, findSigns } from './signs.js'
import { DEFAULT_STEPS, rulesFor, runsOf } from './step-runs.js'
import { turnsOf, type TurnEntry } from './turns.js'

const at = '2026-10-01T10:00:00.000Z'
const entries: TurnEntry[] = [
  { type: 'user', message: { content: 'first prompt' } },
  { type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'c', name: 'Bash', input: { command: 'npm test' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c', content: 'discard '.repeat(1000) + 'timed out' }] } },
  { type: 'assistant', agentId: 'sub', message: { id: 'sub-m', content: [{ type: 'text', text: 'done' }] } },
  { type: 'system', subtype: 'compact_boundary' },
].map((entry, i) => ({ ...entry, uuid: String(i), timestamp: at }))

function analyses(entries: TurnEntry[]) {
  return {
    signs: findSigns(entries, DEFAULT_SIGN_RULES, 'relay'),
    turns: turnsOf(entries, true),
    steps: runsOf(entries, rulesFor(DEFAULT_STEPS, null)),
    excerpt: excerptOf(entries, { agentId: null, fromAt: at, toAt: at }),
  }
}

it('keeps excerpts cut at an emoji well formed, as Postgres refuses a lone surrogate in jsonb', () => {
  const cut = 'a'.repeat(298) + '😀 tail'
  const projected = [
    { type: 'user', message: { content: cut } },
    { type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: cut }, { type: 'tool_use', id: 'c', name: 'Read', input: { file_path: cut } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c', is_error: true, content: cut }] } },
  ].map((entry) => activityOf(entry as TurnEntry)?.event)
  const strings = JSON.stringify(projected).match(/"(?:[^"\\]|\\.)*"/g)!.map((text) => JSON.parse(text) as string)
  expect(strings.filter((text) => !text.isWellFormed())).toEqual([])
})

it('backfills historical activity and accepts retried machine tails without opening the archive for analysis', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tally-activity-'))
  const local = await openLocalTally(join(dir, 'db'), () => {})
  const db = await TallyDb.connect(local.settings)
  const client = new pg.Client(local.settings)
  try {
    await client.connect()
    await client.query("insert into sessions(session_id,account,last_at) values ('s','global',now())")
    const line = (raw: TurnEntry): LineRow => ({ uuid: raw.uuid!, sessionId: 's', agentId: raw.agentId ?? null, at, type: raw.type!, raw })
    const prompt = entries[0]!
    await client.query('insert into lines(uuid,session_id,type,at) values ($1,$2,$3,$4)', [prompt.uuid, 's', prompt.type, at])
    await client.query('insert into line_raws(uuid,raw) values ($1,$2)', [prompt.uuid, prompt])
    await db.backfillActivity()
    const tail = { lines: entries.slice(1).map(line), calls: [], results: [], messages: [], sessions: [] }
    await db.writeMachine('remote', tail)
    await db.writeMachine('remote', tail)
    await client.query('alter table lines rename to offline_archive')
    await client.query('alter table line_raws rename to offline_raws')

    await db.backfillActivity()
    await db.fillPrompts()
    expect((await client.query('select prompt from sessions')).rows).toEqual([{ prompt: 'first prompt' }])
    const projected = await db.sessionEntries('s')
    expect(JSON.stringify(projected)).not.toContain('discard')
    expect(analyses(projected)).toEqual(analyses(entries))
    expect(analyses(projected).steps[0]?.outcome).toBe('timeout')
  } finally {
    await client.end()
    await db.close()
    await local.close()
    rmSync(dir, { recursive: true, force: true })
  }
}, 60_000)
