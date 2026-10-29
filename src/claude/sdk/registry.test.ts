import { describe, expect, it } from 'vitest'
import { parseSdkSession, sdkEntryOf, type SdkSession } from './registry.js'

const session: SdkSession = {
  sessionId: '00000000-0000-4000-8000-0000000000d1',
  name: 'ABC-7',
  cwd: 'C:\\repos\\example-project\\.claude\\worktrees\\abc-7',
  account: 'team-api',
  startedAt: 1_700_000_000_000,
  executor: 4100,
  pipe: '\\\\.\\pipe\\even-keel-sdk-00000000',
  cli: 4101,
  model: 'sonnet',
}

describe('parseSdkSession', () => {
  it('retains original launch settings through a saved record and the monitored entry', () => {
    const settings = '{"autoCompactWindow":300000}'
    const saved = parseSdkSession(JSON.stringify({ ...session, settings }))!
    expect(saved.settings).toBe(settings)
    expect(sdkEntryOf(saved, true, null).settings).toBe(settings)
  })

  it('reads a saved session and drops what it does not know', () => {
    expect(parseSdkSession(JSON.stringify({ version: 10, ...session, bridge: 'cse_01', extra: 1 }))).toEqual({ ...session, bridge: 'cse_01' })
  })

  it('takes no model as the default one and a session without the CLI yet', () => {
    const { cli: _cli, ...early } = session
    expect(parseSdkSession(JSON.stringify({ ...early, model: undefined }))).toEqual({ ...early, model: null })
  })

  it('refuses a broken or incomplete file', () => {
    expect(parseSdkSession('')).toBeUndefined()
    expect(parseSdkSession('[]')).toBeUndefined()
    expect(parseSdkSession(JSON.stringify({ ...session, executor: '4100' }))).toBeUndefined()
    expect(parseSdkSession(JSON.stringify({ ...session, pipe: undefined }))).toBeUndefined()
  })
})

describe('sdkEntryOf', () => {
  const ask = { id: 'toolu_01', questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [] }] }

  it('is a live session on the CLI while its executor lives', () => {
    expect(sdkEntryOf(session, true, { status: 'idle', ask: null })).toMatchObject({ id: session.sessionId, kind: 'sdk', pid: 4101, status: 'idle', state: 'working', model: 'sonnet' })
  })

  it('is blocked on the question it waits on', () => {
    expect(sdkEntryOf(session, true, { status: 'waiting', ask })).toMatchObject({ status: 'waiting', state: 'blocked', ask })
  })

  it('is taken as working until the host is connected, on the executor before the CLI is named', () => {
    const { cli: _cli, ...early } = session
    expect(sdkEntryOf(early, true, null)).toMatchObject({ pid: 4100, status: 'busy', state: 'working' })
  })

  it('is over once the executor is gone or Even Keel stopped it', () => {
    const done = sdkEntryOf(session, false, null)
    expect(done).toMatchObject({ state: 'done' })
    expect(done.pid).toBeUndefined()
    expect(sdkEntryOf({ ...session, stopped: true }, true, null)).toMatchObject({ state: 'stopped' })
  })

  it('takes a message mid-turn while its executor lives, and not once it is over', () => {
    expect(sdkEntryOf(session, true, { status: 'busy', ask: null }).steers).toBe(true)
    expect(sdkEntryOf(session, false, null).steers).toBeUndefined()
    expect(sdkEntryOf({ ...session, stopped: true }, true, null).steers).toBeUndefined()
  })
})
