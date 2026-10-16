import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SESSION_FOLDERS } from '../../tally/src/db.js'
import { migrate, pgliteDb } from '../../tally/src/migrations.js'
import { BASE } from './base-sql.js'

// The project and task of a message on the whole schema in an in-memory PGlite.
const REPO = 'D:\\Projects\\even-keel'
const PARENT = 'abcdef12-0000-4000-8000-000000000000'

type Message = [id: string, session: string, dir: string, task: string | null, at: string]

describe('project of a message', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await db.exec(`set timezone = 'UTC'`)
    await migrate(pgliteDb(db))
    await db.exec(`insert into sessions (session_id, account, launch_task) values
      ('wander', 'a', null), ('${PARENT}', 'a', 'BTN-65'), ('child', 'a', null)`)
    const messages: Message[] = [
      ['w1', 'wander', 'D:\\Work\\App', null, '2026-10-01T10:00:00Z'],
      ['w2', 'wander', 'D:\\Work\\Relay', null, '2026-10-01T10:01:00Z'],
      ['p1', PARENT, REPO, null, '2026-10-01T11:00:00Z'],
      ['k1', 'child', 'C:\\Users\\John\\.claude\\jobs\\abcdef12\\tmp\\repo', 'GHT-17', '2026-10-01T11:05:00Z'],
    ]
    for (const [id, session, dir, task, at] of messages) {
      await db.query(
        `insert into messages (message_id, session_id, account, project_dir, task, at, input, cache_write_5m, cache_write_1h, cache_read, output)
         values ($1, $2, 'a', $3, $4, $5, 0, 0, 0, 0, 0)`,
        [id, session, dir, task, at],
      )
    }
    await db.exec(SESSION_FOLDERS)
  }, 30_000)

  afterAll(async () => {
    await db?.close()
  })

  async function found(): Promise<Record<string, { project: string; task: string | null }>> {
    const folders = ['/work/app', '/work/relay', '/projects/even-keel', '/users/john/.claude/jobs/abcdef12/tmp/repo']
    const { rows } = await db.query<{ message_id: string; project: string; task: string | null }>(
      `${BASE} select message_id, project, task, $3::text as zone from base`,
      [['BTN'], ['/projects/even-keel'], 'UTC', 'all', null, folders, ['App', 'Relay', 'BTN', 'repo']],
    )
    return Object.fromEntries(rows.map(({ message_id, project, task }) => [message_id, { project, task }]))
  }

  it('remembers the folder of the first answer of a session', async () => {
    const { rows } = await db.query<{ session_id: string; project_dir: string }>(
      'select session_id, project_dir from sessions order by session_id',
    )
    expect(Object.fromEntries(rows.map((row) => [row.session_id, row.project_dir]))).toEqual({
      [PARENT]: REPO,
      child: 'C:\\Users\\John\\.claude\\jobs\\abcdef12\\tmp\\repo',
      wander: 'D:\\Work\\App',
    })
  })

  it('keeps a session that ran cd in the folder it started in', async () => {
    const rows = await found()
    expect([rows.w1?.project, rows.w2?.project]).toEqual(['App', 'App'])
  })

  it('gives a session in the temp folder of another one its task and project', async () => {
    expect((await found()).k1).toEqual({ project: 'BTN', task: 'BTN-65' })
  })
})
