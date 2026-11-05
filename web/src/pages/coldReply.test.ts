import { describe, expect, it } from 'vitest'
import { coldReply } from './coldReply.js'

const now = new Date('2026-01-01T12:00:00.000Z')
const session = (lamp: 'waiting' | 'working' | 'error', until: string | null) => ({
  lamp,
  cache: until === null ? null : { ttl: '1h' as const, until },
  contextTokens: 120_000,
})

describe('coldReply', () => {
  it('tells when the cache of a waiting session went cold and how much it rereads', () => {
    expect(coldReply(session('waiting', '2026-01-01T11:20:00.000Z'), now)).toEqual({ since: '2026-01-01T11:20:00.000Z', tokens: 120_000 })
    expect(coldReply(session('error', '2026-01-01T11:20:00.000Z'), now)).not.toBeNull()
  })

  it('lets the reply go as usual while the cache is warm or about to run out', () => {
    expect(coldReply(session('waiting', '2026-01-01T12:40:00.000Z'), now)).toBeNull()
    expect(coldReply(session('waiting', '2026-01-01T12:05:00.000Z'), now)).toBeNull()
  })

  it('lets the reply go as usual to a working session and when the cache is not known', () => {
    expect(coldReply(session('working', '2026-01-01T11:20:00.000Z'), now)).toBeNull()
    expect(coldReply(session('waiting', null), now)).toBeNull()
  })
})
