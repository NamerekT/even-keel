import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/storage/database.js'
import { migrate, pgliteDb } from './migrations.js'
import { TASK_MOVES, taskMoves, type TaskMove } from './task-moves.js'

const MOVED = '11111111-1111-4111-8111-111111111111'
const COPYING = '22222222-2222-4222-8222-222222222222'

describe("taskMoves: the copied tasks of Even Keel's state database (BTN-1076)", { timeout: 120_000 }, () => {
  let state: PGlite

  beforeAll(async () => {
    state = await openDatabase(undefined)
    await state.exec(`
      insert into projects (id, key, repo, branch, position) values
        ('${MOVED}', 'GH', 'C:\\repos\\example', 'main', 0),
        ('${COPYING}', 'DEF', 'C:\\repos\\other', 'main', 1);
      insert into setting_definitions (key, kind, spec, default_value, scopes) values ('tracker', 'enum', '{}', '"huly"', 'project')
        on conflict (key) do nothing;
      insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values
        ('tracker', '${MOVED}', '', '"github"', '2026-11-01T00:00:00.000Z', 'person'),
        ('tracker', '${COPYING}', '', '"builtin"', '2026-11-01T00:00:00.000Z', 'person');
      insert into tracker_exports (project_id, profile, place, key, started_at, finished_at, source_key) values
        ('${MOVED}', 'github-example', 'example/repo', 'GH', '2026-11-12T09:00:00.000Z', '2026-11-12T09:10:00.000Z', 'ABC'),
        ('${COPYING}', 'github-example', 'example/other', 'GHO', '2026-11-12T09:00:00.000Z', null, 'DEF');
      insert into tracker_export_tasks (project_id, task_id, number, new_key, url, stage, marker, done, at) values
        ('${MOVED}', 't1', 5, 'GH-12', null, 'marked', 'even-keel:ABC-5', 0, '2026-11-12T09:01:00.000Z'),
        ('${MOVED}', 't2', 6, 'GH-13', null, 'journaled', 'even-keel:ABC-6', 0, '2026-11-12T09:02:00.000Z'),
        ('${MOVED}', 't3', 7, null, null, 'pending', null, 0, '2026-11-12T09:03:00.000Z'),
        ('${COPYING}', 't4', 1, 'GHO-1', null, 'marked', 'even-keel:DEF-1', 0, '2026-11-12T09:04:00.000Z');`)
  })
  afterAll(() => state.close())

  it('links the marked tasks of a project that left the built-in tracker by its old key', async () => {
    expect(await taskMoves(state)).toEqual([{ old: 'ABC-5', task: 'GH-12' }])
  })

  it('reads none from a database before step 50', async () => {
    const old = await PGlite.create()
    try {
      expect(await taskMoves(old)).toEqual([])
    } finally {
      await old.close()
    }
  })
})

describe('the sessions of an old id count for the new one (BTN-1076)', () => {
  let db: PGlite
  const move = (moves: TaskMove[]) => db.query(TASK_MOVES, [JSON.stringify(moves)])

  beforeAll(async () => {
    db = await PGlite.create()
    await db.exec(`set timezone = 'UTC'`)
    await migrate(pgliteDb(db))
    await db.exec(`
      insert into sessions (session_id, account, launch_task) values ('before', 'a', 'ABC-5'), ('after', 'a', 'GH-12'), ('other', 'a', 'ABC-6');
      insert into tasks (task, title) values ('ABC-5', 'Parse the input'), ('ABC-6', 'Redo the parser');`)
    for (const [id, session] of [['m1', 'before'], ['m2', 'after'], ['m3', 'other']]) {
      await db.query(
        `insert into messages (message_id, session_id, account, task, at, input, cache_write_5m, cache_write_1h, cache_read, output)
         values ($1, $2, 'a', null, '2026-11-12T10:00:00Z', 0, 0, 0, 0, 0)`,
        [id, session],
      )
    }
    await move([{ old: 'ABC-5', task: 'GH-12' }])
  }, 30_000)
  afterAll(() => db?.close())

  const sessionTasks = async () =>
    Object.fromEntries((await db.query<{ session_id: string; task: string }>('select session_id, task from session_tasks')).rows.map((row) => [row.session_id, row.task]))

  it('gives a session of the old id the new one, and its messages too', async () => {
    expect(await sessionTasks()).toEqual({ before: 'GH-12', after: 'GH-12', other: 'ABC-6' })
    const { rows } = await db.query<{ message_id: string; task: string }>('select message_id, task from message_costs order by message_id')
    expect(rows.map((row) => row.task)).toEqual(['GH-12', 'GH-12', 'ABC-6'])
  })

  it('keeps the raw rows on the old id', async () => {
    const { rows } = await db.query<{ launch_task: string }>(`select launch_task from sessions where session_id = 'before'`)
    expect(rows[0]?.launch_task).toBe('ABC-5')
  })

  it("gives the new task the old one's title while no tracker gave it one, and never overwrites a title", async () => {
    const title = async (task: string) => (await db.query<{ title: string | null }>('select title from tasks where task = $1', [task])).rows[0]?.title
    expect(await title('GH-12')).toBe('Parse the input')
    await db.exec(`update tasks set title = 'Parse the input, from GitHub' where task = 'GH-12'`)
    await move([{ old: 'ABC-5', task: 'GH-12' }])
    expect(await title('GH-12')).toBe('Parse the input, from GitHub')
  })

  it('keeps a link once Even Keel no longer gives it', async () => {
    await move([{ old: 'ABC-6', task: 'GH-13' }])
    expect(await sessionTasks()).toEqual({ before: 'GH-12', after: 'GH-12', other: 'GH-13' })
  })
})
