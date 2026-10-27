import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { noticeOf } from '../notice/notice.js'
import { SQLITE_FILE } from './database.js'
import { fixture, mailboxOf, readsWhole } from './database.fixture.js'
import { databaseDirOf } from './owner.js'
import { IMPORTED_SUFFIX, prepareDatabase } from './state-files.js'

describe('frozen SQLite database imports', { timeout: 120_000 }, () => {
  let stateDir: string
  let logs: string[]
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'even-keel-db-sample-'))
    logs = []
  })
  afterEach(() => rmSync(stateDir, { recursive: true, force: true }))

  const prepare = () => prepareDatabase({ stateDir, log: (line) => logs.push(line) })
  const withSqlite = (sql: string) => {
    const file = new DatabaseSync(join(stateDir, SQLITE_FILE))
    file.exec(sql)
    file.close()
  }

  it('of SQLite version 1 is imported whole, once, and the file kept', async () => {
    withSqlite(fixture(1))
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      expect((await mailboxOf(opened.db)).waiting).toEqual([])
    } finally {
      await opened.close()
    }
    expect(existsSync(join(stateDir, SQLITE_FILE))).toBe(false)
    expect(existsSync(join(stateDir, `${SQLITE_FILE}${IMPORTED_SUFFIX}`))).toBe(true)
    expect(logs).toEqual([expect.stringMatching(/moved .*even-keel\.db into/)])
    await (await prepare()).close()
    expect(logs).toHaveLength(1)
  })

  it('of SQLite version 2 is imported with its mailbox', async () => {
    withSqlite(fixture(2))
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      expect(await mailboxOf(opened.db)).toEqual({
        waiting: ['And run the slow tests.'],
        session: [
          ['delivered', 'PostToolUse', []],
          ['returned', null, ['C:\\repos\\example-project\\.temp\\inbox\\case.png']],
          ['waiting', null, []],
        ],
      })
    } finally {
      await opened.close()
    }
  })

  it('refuses a SQLite file a newer Even Keel wrote and writes nothing', async () => {
    withSqlite('PRAGMA user_version = 3')
    const code = await prepare().then(
      () => undefined,
      (error: unknown) => noticeOf(error).code,
    )
    expect(code).toBe('storage.newerDatabase')
    expect(existsSync(databaseDirOf(stateDir))).toBe(false)
    expect(existsSync(join(stateDir, SQLITE_FILE))).toBe(true)
  })
})
