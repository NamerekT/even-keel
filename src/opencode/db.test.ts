import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sessionRows } from './db.js'
import { opencode } from './adapter.js'
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
  it('projects picture counts and serves the stored images through the adapter, scoped to the session and call', async () => {
    const dir = account([{ type: 'tool', tool: 'read', callID: 'c1', state: {
      status: 'completed', input: { filePath: '/deleted/shot.png' }, output: 'Read image', attachments: [
        null, 'not an attachment', 42,
        { type: 'file', mime: 'text/plain', url: 'data:text/plain;base64,bm90IGFuIGltYWdl' },
        { type: 'file', mime: 'image/png', url: 'data:image/png;base64,Zmlyc3Q=' },
        { type: 'file', mime: 'image/png', url: 'file:///deleted/shot.png' },
        { type: 'file', mime: 'image/jpeg', url: 'data:image/jpeg;base64,c2Vjb25k' },
        { type: 'file', mime: 'image/png', url: 'data:image/png;base64,' },
      ],
    } }])
    const rows = (await sessionRows(dir, 'ses_a'))!
    expect(rows.parts[0]).toMatchObject({ images: 2 })
    expect(rows.parts[0]!.data).not.toContain('base64')
    const agent = opencode.setup({ env: () => ({}), timeoutMs: 1000, workDir: dir, checkedCli: () => false, log: () => {}, onCliChange: () => {} })
    const home = { key: 'example', dir, agent: 'opencode' as const }
    expect((await agent.feed(home, 'ses_a', 0))!.lines).toContainEqual(expect.objectContaining({ kind: 'image', tool: 'c1', images: 2 }))
    expect(await agent.image!(home, 'ses_a', 'c1', 0)).toEqual({ type: 'image/png', data: 'Zmlyc3Q=' })
    expect(await agent.image!(home, 'ses_a', 'c1', 1)).toEqual({ type: 'image/jpeg', data: 'c2Vjb25k' })
    expect(await agent.image!(home, 'ses_a', 'c1', 2)).toBeUndefined()
    expect(await agent.image!(home, 'ses_other', 'c1', 0)).toBeUndefined()
    expect(await agent.image!(home, 'ses_a', 'other', 0)).toBeUndefined()
    expect(await agent.image!(home, 'ses_a', 'c1', -1)).toBeUndefined()
    expect(await agent.image!(home, 'ses_a', 'c1', 0.5)).toBeUndefined()
  })

  it("leaves a tool's output and metadata out, but the chat's message the plugin kept in it", async () => {
    const tool = (metadata: Record<string, unknown>) => ({ type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'a\nb', metadata } })
    const dir = account([tool({ exit: 0 }), tool({ exit: 0, evenKeel: { mail: 'Mind the docs.' } }), { type: 'text', text: 'Done.' }])
    const parts = (await sessionRows(dir, 'ses_a'))!.parts.map((part) => JSON.parse(part.data))
    expect(parts[0].state).toEqual({ status: 'completed', input: { command: 'ls' } })
    expect(parts[1].state).toEqual({ status: 'completed', input: { command: 'ls' }, metadata: { evenKeel: { mail: 'Mind the docs.' } } })
    expect(parts[2]).toEqual({ type: 'text', text: 'Done.' })
  })
})
