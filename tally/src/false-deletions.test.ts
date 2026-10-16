import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate, pgliteDb, STEPS } from './migrations.js'

// Step 2 (BTN-150): a run that read no project (the config unread) wrote every project rule file as deleted.
describe('false rule deletions', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await migrate(pgliteDb(db), STEPS.slice(0, 1))
    await db.exec(`
      insert into rule_snapshots (key, at, hash) values
        ('~/.claude/claude.md', '2026-10-01 10:00Z', 'g1'),
        ('/w/a/claude.md', '2026-10-01 10:00Z', 'a1'),
        ('/w/a/.claude/settings.json', '2026-10-01 10:00Z', 's1'),
        ('/w/b/claude.md', '2026-10-01 10:00Z', 'b1'),
        ('/w/a/claude.md', '2026-10-02 10:00Z', null),
        ('/w/a/.claude/settings.json', '2026-10-02 10:00Z', null),
        ('/w/b/claude.md', '2026-10-02 10:00Z', null),
        ('/w/a/claude.md', '2026-10-03 10:00Z', 'a1'),
        ('/w/a/.claude/settings.json', '2026-10-03 10:00Z', 's2'),
        ('/w/b/claude.md', '2026-10-03 10:00Z', 'b1'),
        ('/w/b/claude.md', '2026-10-04 10:00Z', null),
        ('/w/b/claude.md', '2026-10-05 10:00Z', 'b2');
      insert into rule_changes (id, key, at, old_hash, new_hash, source, added, removed) values
        ('d1', '/w/a/claude.md', '2026-10-02 10:00Z', 'a1', null, 'snapshot', 0, 5),
        ('d2', '/w/a/.claude/settings.json', '2026-10-02 10:00Z', 's1', null, 'snapshot', 0, 3),
        ('d3', '/w/b/claude.md', '2026-10-02 10:00Z', 'b1', null, 'snapshot', 0, 4),
        ('c1', '/w/a/claude.md', '2026-10-03 10:00Z', null, 'a1', 'snapshot', 5, 0),
        ('c2', '/w/a/.claude/settings.json', '2026-10-03 10:00Z', null, 's2', 'snapshot', 4, 0),
        ('c3', '/w/b/claude.md', '2026-10-03 10:00Z', null, 'b1', 'snapshot', 4, 0),
        ('t1', '/w/a/claude.md', '2026-10-02 10:00Z', 'a0', 'a1', 'transcript', 1, 1),
        ('r1', '/w/b/claude.md', '2026-10-04 10:00Z', 'b1', null, 'snapshot', 0, 4),
        ('r2', '/w/b/claude.md', '2026-10-05 10:00Z', null, 'b2', 'snapshot', 4, 0);
    `)
    await migrate(pgliteDb(db))
  }, 30_000)

  afterAll(async () => {
    await db.close()
  })

  it('drops the deletions of a run that lost every live project file, keeping a lone real deletion', async () => {
    const { rows } = await db.query<{ key: string; at: string }>(`select key, to_char(at at time zone 'UTC', 'MM-DD') as at from rule_snapshots where hash is null order by key, at`)
    expect(rows).toEqual([{ key: '/w/b/claude.md', at: '10-04' }])
  })

  it('drops the snapshot changes of the false pair so the next run derives them anew, other changes stay', async () => {
    const { rows } = await db.query<{ id: string }>('select id from rule_changes order by id')
    expect(rows.map((row) => row.id)).toEqual(['r1', 'r2', 't1'])
  })
})
