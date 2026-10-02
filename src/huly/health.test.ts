import { describe, expect, it } from 'vitest'
import { worthBroadcast, type HulyHealth } from './health.js'

const live = (lastOkAt: string): HulyHealth => ({ state: 'live', lastOkAt, error: null })

describe('worthBroadcast', () => {
  it('skips a live poll that only moved the last success time', () => {
    expect(worthBroadcast(live('2026-01-01T10:00:00.000Z'), live('2026-01-01T10:00:05.000Z'))).toBe(false)
  })

  it('broadcasts a change of state or error', () => {
    const down: HulyHealth = { state: 'down', lastOkAt: '2026-01-01T10:00:00.000Z', error: 'refused' }
    expect(worthBroadcast(live('2026-01-01T10:00:00.000Z'), down)).toBe(true)
    expect(worthBroadcast(down, { ...down, error: 'timeout' })).toBe(true)
    expect(worthBroadcast(down, live('2026-01-01T10:00:09.000Z'))).toBe(true)
  })

  it('broadcasts the first success, when there was no time yet', () => {
    expect(worthBroadcast({ state: 'connecting', lastOkAt: null, error: null }, live('2026-01-01T10:00:00.000Z'))).toBe(true)
  })
})
