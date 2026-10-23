import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { entryOf, parseSession, threadOf, TurnRegistry, turnEnded, turnsOf, type CodexSession } from './turns.js'

const THREAD = '01a14a18-1d1a-7861-b272-a7d4df8a9b5c'

const session: CodexSession = {
  sessionId: THREAD,
  name: 'ABC-1',
  cwd: 'C:\\repos\\example',
  account: 'codex',
  startedAt: 1_790_000_000_000,
  pid: 4242,
  out: 'C:\\state\\codex\\turns\\ABC-1-1790000000000.jsonl',
}

describe('threadOf', () => {
  it('is the id of the thread.started event', () => {
    expect(threadOf(`{"type":"thread.started","thread_id":"${THREAD}"}\n{"type":"turn.started"}\n`)).toBe(THREAD)
  })

  it('is undefined before the event and for other output', () => {
    expect(threadOf('')).toBeUndefined()
    expect(threadOf('Reading additional input from stdin...\n{"type":"turn.started"}')).toBeUndefined()
  })
})

describe('turnEnded', () => {
  it('sees the completed and the failed turn on the last line', () => {
    expect(turnEnded('{"type":"turn.started"}\n{"type":"turn.completed","usage":{}}\n')).toBe(true)
    expect(turnEnded('{"type":"turn.started"}\n{"type":"turn.failed","error":{"message":"boom"}}')).toBe(true)
  })

  it('is false mid-turn and for a cut line', () => {
    expect(turnEnded('{"type":"turn.started"}\n{"type":"item.completed","item":{}}\n')).toBe(false)
    expect(turnEnded('{"type":"turn.started"}\n{"type":"item.comp')).toBe(false)
  })
})

describe('entryOf', () => {
  it('is a busy session while its turn runs', () => {
    expect(entryOf(session, true)).toEqual({
      id: THREAD,
      sessionId: THREAD,
      kind: 'codex',
      name: 'ABC-1',
      cwd: 'C:\\repos\\example',
      account: 'codex',
      startedAt: 1_790_000_000_000,
      pid: 4242,
      status: 'busy',
      state: 'working',
    })
  })

  it('rests between turns: idle, without a process, still live', () => {
    const entry = entryOf(session, false)
    expect(entry).toMatchObject({ status: 'idle', state: 'working', resting: true })
    expect(entry.pid).toBeUndefined()
  })

  it('is stopped once stopped', () => {
    const entry = entryOf({ ...session, stopped: true }, false)
    expect(entry).toMatchObject({ state: 'stopped' })
    expect(entry.resting).toBeUndefined()
  })
})

describe('parseSession', () => {
  it('reads a saved session and refuses a broken one', () => {
    expect(parseSession(JSON.stringify({ version: 6, ...session }))).toEqual(session)
    expect(parseSession(JSON.stringify({ ...session, stopped: true }))?.stopped).toBe(true)
    expect(parseSession(JSON.stringify({ ...session, pid: 'x' }))).toBeUndefined()
    expect(parseSession('{')).toBeUndefined()
  })
})

describe('TurnRegistry', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('keeps sessions by id and lists those of an account', async () => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-codex-'))
    const registry = new TurnRegistry(dir)
    registry.save(session)
    registry.save({ ...session, sessionId: '01a14a18-0000-7000-8000-000000000002', account: 'other' })
    writeFileSync(join(dir, 'sessions', 'broken.json'), '{')
    expect((await registry.list('codex')).map((each) => each.sessionId)).toEqual([THREAD])
    expect(await registry.get(THREAD)).toEqual(session)
    expect(await registry.get('missing')).toBeUndefined()
    expect(registry.turnFile('ABC-1', 5)).toBe(join(dir, 'turns', 'ABC-1-5.jsonl'))
  })
})

describe('turnsOf', () => {
  it("gives the session's own turns since it started, oldest first", () => {
    const names = ['ABC-1-30.jsonl', 'ABC-12-20.jsonl', 'ABC-1-5.jsonl', 'ABC-1-10.jsonl', 'ABC-1-FIX-11.jsonl', 'ABC-1-12.txt']
    expect(turnsOf(names, { name: 'ABC-1', startedAt: 10 })).toEqual(['ABC-1-10.jsonl', 'ABC-1-30.jsonl'])
  })
})
