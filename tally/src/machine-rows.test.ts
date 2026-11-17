import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { expect, it } from 'vitest'
import { TallyDb } from './db.js'
import { openLocalTally } from './local.js'
import { emptyBatch, type MessageRow, type SessionRow } from './parse.js'
import { isMachineRows, type MachineRows } from './machine-rows.js'

const message = (messageId: string, account: string): MessageRow => ({
  messageId, sessionId: 's1', agentId: null, account, project: 'example', projectDir: '/work/example', task: null, branch: null,
  entrypoint: 'cli', model: 'claude-sonnet-5-5', speed: null, effort: null, at: '2026-11-17T10:00:00.000Z',
  input: 10, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 5, provider: 'anthropic',
})

const session = (sessionId: string, account: string): SessionRow => ({
  sessionId, account, project: 'example', customTitle: null, aiTitle: null, launchTask: null, launchReason: null,
  firstAt: '2026-11-17T10:00:00.000Z', lastAt: '2026-11-17T10:00:00.000Z',
})

const rows = (): MachineRows => ({
  lines: [{ uuid: 'u1', sessionId: 's1', agentId: null, type: 'assistant', at: '2026-11-17T10:00:00.000Z', raw: {} }],
  messages: [message('m1', 'global')],
  calls: [],
  results: [],
  sessions: [session('s1', 'global')],
})

it("writes a machine's rows with its id and its own account, once however often they come", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tally-machine-rows-'))
  const local = await openLocalTally(join(dir, 'db'), () => {})
  const db = await TallyDb.connect(local.settings)
  const client = new pg.Client(local.settings)
  try {
    await db.migrate()
    await db.writeMachine('machine-1', rows())
    await db.writeMachine('machine-1', rows())
    const own = emptyBatch()
    own.messages.set('m2', message('m2', 'global'))
    own.sessions.set('s2', session('s2', 'global'))
    await db.write(own, { path: '/own.jsonl', account: 'global', offset: 1, size: 1, mtime: '2026-11-17T10:00:00.000Z', ino: '1', head: '', headLen: 0 })

    await client.connect()
    const messages = await client.query('select message_id, account, machine from messages order by message_id')
    expect(messages.rows).toEqual([
      { message_id: 'm1', account: 'global@machine-1', machine: 'machine-1' },
      { message_id: 'm2', account: 'global', machine: null },
    ])
    const sessions = await client.query('select session_id, account, machine from sessions order by session_id')
    expect(sessions.rows).toEqual([
      { session_id: 's1', account: 'global@machine-1', machine: 'machine-1' },
      { session_id: 's2', account: 'global', machine: null },
    ])
    expect((await client.query('select uuid from lines')).rows).toEqual([{ uuid: 'u1' }])
    // The machine's marks are its own: the hub keeps none of its files.
    expect((await client.query('select path from files')).rows).toEqual([{ path: '/own.jsonl' }])
  } finally {
    await client.end().catch(() => {})
    await db.close()
    await local.close()
    rmSync(dir, { recursive: true, force: true })
  }
}, 60_000)

it('refuses rows of another shape whole', () => {
  expect(isMachineRows(rows())).toBe(true)
  expect(isMachineRows({ ...rows(), lines: 'nope' })).toBe(false)
  expect(isMachineRows({ ...rows(), messages: [1] })).toBe(false)
  expect(isMachineRows(null)).toBe(false)
})
