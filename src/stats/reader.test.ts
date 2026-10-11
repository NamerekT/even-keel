import { describe, expect, it } from 'vitest'
import type { PeriodQuery } from './model.js'
import { mapHistory, mapPeriod, mapTask, rulesKey } from './reader.js'
import type { RulesQuery } from './rules.js'

const AT = new Date('2026-10-03T12:00:00Z')
const QUERY: PeriodQuery = { scope: 'all', account: null, tz: 'UTC', from: '2026-09-27', to: '2026-10-03', projects: null }

describe('mapHistory', () => {
  it('indexes days and projects, the most expensive project first', () => {
    const rows = [
      { day: '2026-10-01', project: 'ABC', cost: '1.5', sessions: '1', limit_share: null },
      { day: '2026-10-01', project: 'Example', cost: '4', sessions: '2', limit_share: 0.25 },
      { day: '2026-10-03', project: 'ABC', cost: '0.123456', sessions: '0', limit_share: 1.23456 },
    ]
    const coverage = [{ from_day: '2026-10-03', to_day: '2026-10-03' }]
    const history = mapHistory(rows, [{ account: 'global' }], coverage, ['ABC'], AT)
    expect(history).toEqual({
      at: '2026-10-03T12:00:00.000Z',
      accounts: ['global'],
      tracked: ['ABC'],
      projects: ['Example', 'ABC'],
      days: ['2026-10-01', '2026-10-03'],
      cells: [
        [0, 1, 1.5, 1, 0],
        [0, 0, 4, 2, 0.25],
        [1, 1, 0.1235, 0, 1.235],
      ],
      limits: { from: '2026-10-03', to: '2026-10-03' },
    })
  })

  it('has no limit coverage without snapshots', () => {
    expect(mapHistory([], [], [{ from_day: null, to_day: null }], [], AT).limits).toBeNull()
  })
})

describe('mapPeriod', () => {
  const empty = { totals: [], coverage: [], windows: [], models: [], entrypoints: [], tasks: [], weeks: [], stuck: [] }

  it('splits the totals into this period and the previous one and zeroes a missing side', () => {
    const totals = [{ cur: true, cost: '12.5', messages: '40', sessions: '3', tasks: '2', unpriced: '0', limit_share: 2.25, stuck_cost: '1.5' }]
    const period = mapPeriod(QUERY, { ...empty, totals }, AT)
    expect(period.current).toEqual({ cost: 12.5, messages: 40, sessions: 3, tasks: 2, unpriced: 0, limit: 2.25, stuckCost: 1.5 })
    expect(period.previous).toEqual({ cost: 0, messages: 0, sessions: 0, tasks: 0, unpriced: 0, limit: null, stuckCost: 0 })
    expect(period.limits).toBeNull()
    expect(period.windows).toEqual([])
  })

  it('maps the limit coverage and the peaks of weekly windows', () => {
    const period = mapPeriod(
      QUERY,
      {
        ...empty,
        coverage: [{ from_day: '2026-10-01', to_day: '2026-10-03' }],
        windows: [
          { account: 'global', resets_at: new Date('2026-10-03T13:00:00Z'), peak: 100, open: false },
          { account: 'global', resets_at: new Date('2026-10-10T13:00:00Z'), peak: 22.5, open: true },
        ],
      },
      AT,
    )
    expect(period.limits).toEqual({ from: '2026-10-01', to: '2026-10-03' })
    expect(period.windows).toEqual([
      { account: 'global', resetsAt: '2026-10-03T13:00:00.000Z', peak: 100, open: false },
      { account: 'global', resetsAt: '2026-10-10T13:00:00.000Z', peak: 22.5, open: true },
    ])
  })

  it('maps shares, tasks, weeks and spans', () => {
    const period = mapPeriod(
      QUERY,
      {
        ...empty,
        models: [{ key: 'opus', cost: '3.2' }],
        tasks: [
          {
            task: 'ABC-1',
            project: 'ABC',
            title: 'Example',
            status: 'Done',
            cost: '3.2',
            limit_share: null,
            sessions: '2',
            relays: '0',
            checkpoints: '1',
            restarts: '0',
            spans: '1',
            rework: true,
            estimate_h: '1.5',
            active_s: '4210.5',
            wait_s: '600',
            total_s: '9000',
            done: true,
            component: 'Web',
            model: 'opus',
          },
          { task: 'ABC-2', project: 'ABC', cost: '1', sessions: '1', estimate_h: null, active_s: null, wait_s: null, total_s: null, done: null },
        ],
        weeks: [{ week: '2026-09-28', reason: null, spans: '2' }],
        stuck: [
          {
            id: 'span-1',
            task: null,
            project: 'Example',
            session_id: 'session-1',
            from_at: new Date('2026-10-01T10:00:00Z'),
            to_at: new Date('2026-10-01T10:05:00Z'),
            kinds: ['repeat'],
            reason: null,
            note: null,
          },
        ],
      },
      AT,
    )
    expect(period.models).toEqual([{ key: 'opus', cost: 3.2 }])
    expect(period.tasks[0]).toEqual({
      task: 'ABC-1',
      project: 'ABC',
      title: 'Example',
      status: 'Done',
      cost: 3.2,
      limit: null,
      sessions: 2,
      relays: 0,
      checkpoints: 1,
      restarts: 0,
      spans: 1,
      rework: true,
      estimateH: 1.5,
      activeS: 4210.5,
      waitS: 600,
      totalS: 9000,
      done: true,
      component: 'Web',
      model: 'opus',
    })
    expect(period.tasks[1]).toMatchObject({ estimateH: null, activeS: null, waitS: null, totalS: null, done: null, component: null, model: null })
    expect(period.weeks).toEqual([{ week: '2026-09-28', reason: null, spans: 2 }])
    expect(period.stuck[0]).toMatchObject({ project: 'Example', sessionId: 'session-1', toAt: '2026-10-01T10:05:00.000Z', kinds: ['repeat'] })
  })
})

describe('mapTask', () => {
  it('maps the sessions of a task in order', () => {
    const detail = mapTask(
      'ABC-1',
      [
        {
          session_id: 'session-1',
          title: null,
          launch_reason: 'checkpoint',
          model: 'claude-opus-5',
          first_at: new Date('2026-10-01T10:00:00Z'),
          last_at: new Date('2026-10-01T11:00:00Z'),
          cost: '2',
          account: 'work',
        },
      ],
      [],
    )
    expect(detail).toEqual({
      task: 'ABC-1',
      sessions: [
        {
          sessionId: 'session-1',
          title: null,
          reason: 'checkpoint',
          model: 'claude-opus-5',
          firstAt: '2026-10-01T10:00:00.000Z',
          lastAt: '2026-10-01T11:00:00.000Z',
          cost: 2,
          account: 'work',
        },
      ],
      spans: [],
      steps: [],
    })
  })
})

describe('rulesKey', () => {
  const rules: RulesQuery = { scope: 'all', account: null, tz: 'UTC', projects: null, kinds: null, purposes: null }
  const settings = { minTasks: 5, minSessions: 10, days: 7 }

  it('tells apart queries that differ in any filter', () => {
    const keys = [
      rules,
      { ...rules, purposes: ['quality' as const] },
      { ...rules, purposes: ['economy' as const] },
      { ...rules, kinds: ['hook' as const] },
      { ...rules, projects: ['ABC'] },
      { ...rules, tz: 'Europe/Berlin' },
    ].map((query) => rulesKey(query, settings))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('changes with the compare settings', () => {
    expect(rulesKey(rules, settings)).not.toBe(rulesKey(rules, { ...settings, minSessions: 3 }))
  })
})
