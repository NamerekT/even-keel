import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROMPTS } from '../../src/chain/prompts.js'
import { databaseFile } from '../../src/opencode/home.js'
import { openCodeTurns, openCodeTurnSources } from './opencode-turns.js'

const T0 = Date.parse('2026-10-01T10:00:00Z')
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString()
const ms = (seconds: number) => T0 + seconds * 1000
const tokens = { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
const user = (id: string, seconds: number, text: string | null, sub = 0) => ({ id, sub, at: ms(seconds), data: JSON.stringify({ role: 'user' }), text })
const reply = (id: string, seconds: number, done: number | null, extra: Record<string, unknown> = {}, sub = 0) => ({
  id, sub, at: ms(seconds), text: null,
  data: JSON.stringify({ role: 'assistant', tokens, time: { created: ms(seconds), ...(done === null ? {} : { completed: ms(done) }) }, ...extra }),
})

describe('OpenCode turns', () => {
  it("starts a turn at each user prompt, counts its responses with tokens and ends at the last one's completion", () => {
    expect(openCodeTurns([
      user('msg_1', 0, 'DEMO-1'),
      reply('msg_2', 1, 10),
      reply('msg_3', 10, 30),
      reply('msg_4', 30, null, { tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }),
      user('msg_5', 100, 'and the tests?'),
      reply('msg_6', 101, 120),
    ], true)).toEqual([
      { startUuid: 'msg_1', start: 'launch', startedAt: at(0), endedAt: at(30), replies: 2, askSeconds: 0, limited: false, cliSeconds: null },
      { startUuid: 'msg_5', start: 'prompt', startedAt: at(100), endedAt: at(120), replies: 1, askSeconds: 0, limited: false, cliSeconds: null },
    ])
  })

  it("takes a resume prompt, keeps a subagent's work inside the parent's turn and a text-less message out of the starts", () => {
    const turns = openCodeTurns([
      user('msg_1', 0, 'DEMO-1'),
      reply('msg_2', 1, 5),
      user('msg_3', 6, 'explore the area', 1),
      reply('msg_4', 7, 60, {}, 1),
      user('msg_5', 61, null),
      reply('msg_6', 62, 70),
      user('msg_7', 200, `${PROMPTS.en.resume}\n`),
      reply('msg_8', 201, 210),
    ], true)
    expect(turns.map(({ startUuid, start, endedAt, replies }) => ({ startUuid, start, endedAt, replies }))).toEqual([
      { startUuid: 'msg_1', start: 'launch', endedAt: at(70), replies: 2 },
      { startUuid: 'msg_7', start: 'resume', endedAt: at(210), replies: 1 },
    ])
  })

  it('marks a turn that hit a usage limit', () => {
    const limit = { name: 'APIError', data: { message: 'Rate limit reached', statusCode: 429 } }
    const other = { name: 'APIError', data: { message: 'model not supported', statusCode: 400 } }
    expect(openCodeTurns([user('msg_1', 0, 'a'), reply('msg_2', 1, null, { error: limit })], false)[0]).toMatchObject({ limited: true, endedAt: at(1) })
    expect(openCodeTurns([user('msg_1', 0, 'a'), reply('msg_2', 1, null, { error: other })], false)[0]).toMatchObject({ limited: false, start: 'prompt' })
  })
})

describe('openCodeTurnSources', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it("lists the database's own sessions and reads each with its subagents' messages", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tally-opencode-turns-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'data', 'opencode'), { recursive: true })
    const file = databaseFile(dir)
    const db = new DatabaseSync(file)
    db.exec(`
      create table session (id text primary key, parent_id text, title text);
      create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);
      create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text);
      insert into session values ('ses_a', null, 'DEMO-1'), ('ses_b', 'ses_a', 'explore'), ('ses_c', null, 'DEMO-2');
    `)
    const message = db.prepare('insert into message values (?, ?, ?, ?, ?)')
    const part = db.prepare('insert into part values (?, ?, ?, 0, 0, ?)')
    message.run('msg_1', 'ses_a', ms(0), ms(0), JSON.stringify({ role: 'user', summary: { diffs: ['big'] } }))
    part.run('prt_1', 'msg_1', 'ses_a', JSON.stringify({ type: 'text', text: 'DEMO-1' }))
    part.run('prt_2', 'msg_1', 'ses_a', JSON.stringify({ type: 'file', url: 'file:///a.png' }))
    message.run('msg_2', 'ses_a', ms(1), ms(5), JSON.stringify({ role: 'assistant', tokens, time: { created: ms(1), completed: ms(5) } }))
    message.run('msg_3', 'ses_b', ms(2), ms(2), JSON.stringify({ role: 'user' }))
    part.run('prt_3', 'msg_3', 'ses_b', JSON.stringify({ type: 'text', text: 'explore' }))
    message.run('msg_4', 'ses_b', ms(3), ms(40), JSON.stringify({ role: 'assistant', tokens, time: { created: ms(3), completed: ms(40) } }))
    db.close()

    const sources = await openCodeTurnSources([{ path: file, account: 'opencode' }])
    expect(sources.map((source) => [source.session, source.path])).toEqual([['ses_a', file], ['ses_c', file]])
    expect(sources[0]!.key(true)).toMatch(/^opencode:\d+:/)
    expect(await sources[0]!.read(true)).toEqual([
      { startUuid: 'msg_1', start: 'launch', startedAt: at(0), endedAt: at(40), replies: 1, askSeconds: 0, limited: false, cliSeconds: null },
    ])
    expect(await openCodeTurnSources([{ path: join(dir, 'missing.db'), account: 'opencode' }])).toEqual([])
  })
})
