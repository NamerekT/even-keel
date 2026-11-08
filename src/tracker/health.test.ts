import { describe, expect, it } from 'vitest'
import { readFresh, worthBroadcast, type TrackerHealth, type TrackerView } from './health.js'

const live = (lastOkAt: string): TrackerHealth => ({ state: 'live', lastOkAt, error: null })

describe('worthBroadcast', () => {
  it('skips a live poll that only moved the last success time', () => {
    expect(worthBroadcast(live('2026-01-01T10:00:00.000Z'), live('2026-01-01T10:00:05.000Z'))).toBe(false)
  })

  it('broadcasts a change of state or error', () => {
    const down: TrackerHealth = { state: 'down', lastOkAt: '2026-01-01T10:00:00.000Z', error: 'refused' }
    expect(worthBroadcast(live('2026-01-01T10:00:00.000Z'), down)).toBe(true)
    expect(worthBroadcast(down, { ...down, error: 'timeout' })).toBe(true)
    expect(worthBroadcast(down, live('2026-01-01T10:00:09.000Z'))).toBe(true)
  })

  it('broadcasts the first success, when there was no time yet', () => {
    expect(worthBroadcast({ state: 'connecting', lastOkAt: null, error: null }, live('2026-01-01T10:00:00.000Z'))).toBe(true)
  })
})

describe('readFresh (BTN-830)', () => {
  const view = (more: Partial<TrackerView>): TrackerView => ({
    name: 'work', kind: 'huly', title: 'Huly', projects: ['ABC'], ready: true, health: live('2026-01-01T10:00:00.000Z'), readAt: {}, ...more,
  })

  it('is fresh once the reader was read in full since the link last turned live', () => {
    expect(readFresh(view({ liveSince: '2026-01-01T10:00:00.000Z', readAt: { ABC: '2026-01-01T10:00:00.000Z' } }), 'ABC')).toBe(true)
    expect(readFresh(view({ liveSince: '2026-01-01T10:00:00.000Z', readAt: { ABC: '2026-01-01T09:59:00.000Z' } }), 'ABC')).toBe(false)
    expect(readFresh(view({ liveSince: '2026-01-01T10:00:00.000Z' }), 'ABC')).toBe(false)
  })

  it('is not fresh while the link is down or connecting, whatever was read', () => {
    const readAt = { ABC: '2026-01-01T10:01:00.000Z' }
    expect(readFresh(view({ liveSince: '2026-01-01T10:00:00.000Z', readAt, health: { state: 'down', lastOkAt: null, error: 'x' } }), 'ABC')).toBe(false)
    expect(readFresh(view({ liveSince: '2026-01-01T10:00:00.000Z', readAt, health: { state: 'connecting', lastOkAt: null, error: null } }), 'ABC')).toBe(false)
  })
})
