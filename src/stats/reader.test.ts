import { describe, expect, it } from 'vitest'
import { mapStats } from './reader.js'

const AT = new Date('2026-10-03T12:00:00Z')
const QUERY = { days: 7, scope: 'all' } as const

const total = {
  since: new Date('2026-09-26T12:00:00Z'),
  cost: '12.5',
  previous_cost: '0',
  messages: '40',
  sessions: '3',
  unpriced: '0',
  five_hour: null,
  seven_day: 2.25,
  service_cost: '1.5',
  service_sessions: '1',
}

describe('mapStats', () => {
  it('turns numeric strings from pg into numbers and keeps missing shares empty', () => {
    const stats = mapStats('ABC', QUERY, { total, tasks: [], repeats: [], stuck: [], reasons: [] }, AT)
    expect(stats.since).toBe('2026-09-26T12:00:00.000Z')
    expect(stats.total).toEqual({ cost: 12.5, previousCost: 0, messages: 40, sessions: 3, unpriced: 0, fiveHour: null, sevenDay: 2.25 })
    expect(stats.service).toEqual({ cost: 1.5, sessions: 1 })
  })

  it('maps tasks, repeats, spans and reasons', () => {
    const stats = mapStats(
      'ABC',
      QUERY,
      {
        total,
        tasks: [{ task: 'ABC-1', title: 'Example', status: 'Done', cost: '3.2', sessions: '2', seven_day: null }],
        repeats: [{ task: 'ABC-1', title: null, status: null, sessions: '2', relays: '0', checkpoints: '1', restarts: '0', spans: '1', rework: true }],
        stuck: [
          {
            id: 'span-1',
            task: null,
            session_id: 'session-1',
            from_at: new Date('2026-10-01T10:00:00Z'),
            to_at: new Date('2026-10-01T10:05:00Z'),
            kinds: ['repeat'],
            reason: null,
            note: null,
          },
        ],
        reasons: [{ reason: 'debug_loop', spans: '2' }, { reason: null, spans: '1' }],
      },
      AT,
    )
    expect(stats.tasks).toEqual([{ task: 'ABC-1', title: 'Example', status: 'Done', cost: 3.2, sessions: 2, sevenDay: null }])
    expect(stats.repeats[0]).toMatchObject({ sessions: 2, checkpoints: 1, spans: 1, rework: true })
    expect(stats.stuck[0]).toMatchObject({ sessionId: 'session-1', toAt: '2026-10-01T10:05:00.000Z', kinds: ['repeat'], reason: null })
    expect(stats.reasons).toEqual([
      { reason: 'debug_loop', spans: 2 },
      { reason: null, spans: 1 },
    ])
  })
})
