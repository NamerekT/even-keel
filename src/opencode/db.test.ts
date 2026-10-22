import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sessionRows } from './db.js'
import { databaseFile } from './home.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** An account folder whose `opencode.db` has the columns Even Keel reads, as OpenCode 1.18.25 makes them. */
function account(parts: Record<string, unknown>[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'ek-opencode-db-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'data', 'opencode'), { recursive: true })
  const db = new DatabaseSync(databaseFile(dir))
  db.exec(`
    create table session (id text primary key, parent_id text, title text, directory text, time_created integer, time_updated integer);
    create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);
    create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text);
    insert into session values ('ses_a', null, 'DEMO-1', '/work/demo', 1, 1);
    insert into message values ('msg_a', 'ses_a', 1, 1, '{"role":"assistant"}');
  `)
  const insert = db.prepare("insert into part values (?, 'msg_a', 'ses_a', 1, 1, ?)")
  parts.forEach((part, index) => insert.run(`prt_${index}`, JSON.stringify(part)))
  db.close()
  return dir
}

describe('sessionRows', () => {
  it("leaves a tool's output and metadata out, but the chat's message the plugin kept in it", async () => {
    const tool = (metadata: Record<string, unknown>) => ({ type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'a\nb', metadata } })
    const dir = account([tool({ exit: 0 }), tool({ exit: 0, evenKeel: { mail: 'Mind the docs.' } }), { type: 'text', text: 'Done.' }])
    const parts = (await sessionRows(dir, 'ses_a'))!.parts.map((part) => JSON.parse(part.data))
    expect(parts[0].state).toEqual({ status: 'completed', input: { command: 'ls' } })
    expect(parts[1].state).toEqual({ status: 'completed', input: { command: 'ls' }, metadata: { evenKeel: { mail: 'Mind the docs.' } } })
    expect(parts[2]).toEqual({ type: 'text', text: 'Done.' })
  })
})
