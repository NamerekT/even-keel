import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate, pgliteDb } from './migrations.js'

// Context compactions as rows (schema step 4) on the whole schema in an in-memory PGlite.

type Line = [uuid: string, session: string, agent: string | null, type: string, at: string, raw: Record<string, unknown>]

const boundary = (pre: number, post: number, trigger = 'auto') => ({
  subtype: 'compact_boundary',
  content: 'Conversation compacted',
  parentUuid: null,
  compactMetadata: { trigger, preTokens: pre, postTokens: post, durationMs: 26 },
})
const summary = (parentUuid: string, content: unknown) => ({ parentUuid, isCompactSummary: true, message: { role: 'user', content } })
const attachment = (parentUuid: string) => ({ parentUuid, attachment: { type: 'date' } })

describe('compactions', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await db.exec(`set timezone = 'UTC'`)
    await migrate(pgliteDb(db))
    const lines: Line[] = [
      ['s-b1', 's', null, 'system', '2026-10-01T10:00:00Z', boundary(200000, 30000, 'manual')],
      ['s-sum1', 's', null, 'user', '2026-10-01T10:00:01Z', summary('s-b1', 'x'.repeat(1200))],
      ['s-b2', 's', null, 'system', '2026-10-01T11:00:00Z', boundary(210000, 29000)],
      ['s-att1', 's', null, 'attachment', '2026-10-01T11:00:00Z', attachment('s-b2')],
      ['s-att2', 's', null, 'attachment', '2026-10-01T11:00:00Z', attachment('s-att1')],
      ['s-sum2', 's', null, 'user', '2026-10-01T10:58:00Z', summary('s-att2', `${'y'.repeat(2000)}…[+13609]`)],
      ['s-b3', 's', null, 'system', '2026-10-01T12:00:00Z', boundary(205000, 31000)],
      ['a-b1', 's', 'agent1', 'system', '2026-10-01T10:30:00Z', boundary(150000, 20000)],
      ['a-sum1', 's', 'agent1', 'user', '2026-10-01T10:30:01Z', summary('a-b1', [{ type: 'text', text: 'abc' }, { type: 'text', text: 'de' }])],
    ]
    for (const [uuid, session, agent, type, at, raw] of lines) {
      await db.query('insert into lines (uuid, session_id, agent_id, type, at, raw) values ($1, $2, $3, $4, $5, $6)', [uuid, session, agent, type, at, { ...raw, type, uuid }])
    }
  }, 30_000)

  afterAll(async () => {
    await db?.close()
  })

  async function rows(): Promise<Record<string, Record<string, unknown>>> {
    const { rows } = await db.query<Record<string, unknown>>(
      `select uuid, agent_id, trigger, pre_tokens, post_tokens, duration_ms, summary_chars, seq,
         to_char(next_at, 'HH24:MI') as next_at from compactions`,
    )
    return Object.fromEntries(rows.map((row) => [row.uuid as string, row]))
  }

  it('gives one row per boundary with its metadata', async () => {
    expect((await rows())['s-b1']).toMatchObject({ agent_id: null, trigger: 'manual', pre_tokens: 200000, post_tokens: 30000, duration_ms: 26 })
  })

  it('numbers the compactions of a stream and points each to the next one', async () => {
    const found = await rows()
    expect([found['s-b1'], found['s-b2'], found['s-b3']].map((row) => [row!.seq, row!.next_at])).toEqual([
      [1, '11:00'],
      [2, '12:00'],
      [3, null],
    ])
    expect(found['a-b1']).toMatchObject({ agent_id: 'agent1', seq: 1, next_at: null })
  })

  it('measures the summary hung on the boundary directly or through attachments, whole even when cut', async () => {
    const found = await rows()
    expect([found['s-b1']!.summary_chars, found['s-b2']!.summary_chars, found['a-b1']!.summary_chars]).toEqual([1200, 15609, 5])
  })

  it('leaves the size empty for a boundary without a summary', async () => {
    expect((await rows())['s-b3']!.summary_chars).toBeNull()
  })
})
