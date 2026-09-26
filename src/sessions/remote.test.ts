import { describe, expect, it } from 'vitest'
import { bridgeOfRecord, remoteAtStartup, remoteLink, remoteUrlOf } from './remote.js'

const SESSION = '86e70ef5-0000-4000-8000-000000000001'
const record = (fields: Record<string, unknown>) => JSON.stringify({ pid: 1234, sessionId: SESSION, kind: 'bg', ...fields })

describe('remoteUrlOf', () => {
  it('builds the link from either form of the bridge id', () => {
    expect(remoteUrlOf('session_01Example')).toBe('https://claude.ai/code/session_01Example')
    expect(remoteUrlOf('cse_01Example')).toBe('https://claude.ai/code/session_01Example')
  })
})

describe('bridgeOfRecord', () => {
  it('reads the bridge of a background session from its registry record', () => {
    expect(bridgeOfRecord(record({ bridgeSessionId: 'session_01Example' }), SESSION)).toBe('session_01Example')
  })

  it('ignores a record left by another session under a reused pid', () => {
    expect(bridgeOfRecord(record({ sessionId: 'other', bridgeSessionId: 'session_01Example' }), SESSION)).toBeNull()
  })

  it('has no bridge when the record lacks one, is missing or is broken', () => {
    expect(bridgeOfRecord(record({}), SESSION)).toBeNull()
    expect(bridgeOfRecord(undefined, SESSION)).toBeNull()
    expect(bridgeOfRecord('{"pid":', SESSION)).toBeNull()
  })
})

describe('remoteAtStartup', () => {
  it('is on only when the user settings turn it on', () => {
    expect(remoteAtStartup('{"remoteControlAtStartup": true}')).toBe(true)
    expect(remoteAtStartup('{"remoteControlAtStartup": false}')).toBe(false)
    expect(remoteAtStartup('{}')).toBe(false)
    expect(remoteAtStartup(undefined)).toBe(false)
    expect(remoteAtStartup('not json')).toBe(false)
  })
})

describe('remoteLink', () => {
  const startedAt = Date.parse('2026-01-01T10:00:00Z')
  const base = { bridge: null, transcriptUrl: null, enabled: true, startedAt, now: startedAt + 60_000 }

  it('prefers the registry bridge over the transcript', () => {
    expect(remoteLink({ ...base, bridge: 'session_01Registry', transcriptUrl: 'https://claude.ai/code/session_01Old' })).toEqual({
      url: 'https://claude.ai/code/session_01Registry',
      off: null,
    })
  })

  it('falls back to the transcript bridge of a desktop session', () => {
    expect(remoteLink({ ...base, transcriptUrl: 'https://claude.ai/code/session_01Desktop' })).toEqual({
      url: 'https://claude.ai/code/session_01Desktop',
      off: null,
    })
  })

  it('gives a young session time to bring the bridge up', () => {
    expect(remoteLink({ ...base, now: startedAt + 10_000 })).toEqual({ url: null, off: 'starting' })
  })

  it('names disabled startup as the reason before blaming the session', () => {
    expect(remoteLink({ ...base, enabled: false })).toEqual({ url: null, off: 'disabled' })
    expect(remoteLink({ ...base, enabled: false, now: startedAt + 10_000 })).toEqual({ url: null, off: 'disabled' })
  })

  it('reports a session that never brought its bridge up', () => {
    expect(remoteLink(base)).toEqual({ url: null, off: 'no-bridge' })
  })
})
