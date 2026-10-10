import { describe, expect, it } from 'vitest'
import type { StatsShare, StatsTaskRow, StatsTotals, StatsWeekReason } from '../../../src/stats/model.js'
import type { Accuracy } from './accuracy.js'
import { estimateRemark, sourcesRemark, stampOf, stuckRemark, tasksRemark } from './remarks.js'

const totals = (extra: Partial<StatsTotals> = {}): StatsTotals => ({
  cost: 100,
  messages: 500,
  sessions: 10,
  tasks: 3,
  unpriced: 0,
  limit: null,
  stuckCost: 10,
  ...extra,
})
const row = (task: string, extra: Partial<StatsTaskRow> = {}): StatsTaskRow => ({ task, cost: 10, sessions: 1, ...extra }) as StatsTaskRow
const share = (key: string, cost: number): StatsShare => ({ key, cost })
const week = (reason: string | null, spans: number, day = '2026-10-05'): StatsWeekReason => ({ week: day, reason, spans })
const accuracy = (extra: Partial<Accuracy> = {}): Accuracy =>
  ({ compared: 8, within: 50, within2: 75, ratio: 1.1, baseline: { within: 40, within2: 70 }, ...extra }) as Accuracy

describe('stampOf', () => {
  it('stamps dead calm on a period with no spend', () => {
    expect(stampOf(totals({ cost: 0, stuckCost: 0 }), totals())).toEqual({ kind: 'calm' })
  })

  it('stamps over budget when the spend at least doubled, with how many times', () => {
    expect(stampOf(totals({ cost: 250 }), totals({ cost: 100 }))).toEqual({ kind: 'overspend', times: 2.5 })
  })

  it('puts over budget above running aground', () => {
    expect(stampOf(totals({ cost: 300, stuckCost: 150 }), totals())).toMatchObject({ kind: 'overspend' })
  })

  it('stamps aground when a quarter of the money went to stuck spans', () => {
    expect(stampOf(totals({ stuckCost: 25 }), totals())).toEqual({ kind: 'aground', share: 25 })
  })

  it('finds a halved spend suspicious', () => {
    expect(stampOf(totals({ cost: 40, stuckCost: 0 }), totals({ cost: 100 }))).toEqual({ kind: 'bargain' })
  })

  it('certifies an even keel: several tasks and almost no stuck spend', () => {
    expect(stampOf(totals({ tasks: 5, stuckCost: 4 }), totals())).toEqual({ kind: 'evenKeel' })
    expect(stampOf(totals({ tasks: 4, stuckCost: 4 }), totals())).toBeNull()
  })

  it('compares with nothing when the previous period had no spend', () => {
    expect(stampOf(totals({ cost: 500, stuckCost: 50 }), totals({ cost: 0 }))).toBeNull()
  })
})

describe('sourcesRemark', () => {
  it('calls one model with nine tenths of the spend a monoculture', () => {
    expect(sourcesRemark([share('opus', 95), share('haiku', 5)])).toEqual({ kind: 'mono', model: 'opus' })
  })

  it('stays silent on a mix or no spend', () => {
    expect(sourcesRemark([share('opus', 80), share('sonnet', 20)])).toBeNull()
    expect(sourcesRemark([])).toBeNull()
  })
})

describe('estimateRemark', () => {
  it('needs enough compared tasks to judge', () => {
    expect(estimateRemark(accuracy({ compared: 4, within: 90 }))).toBeNull()
  })

  it('first of all notices the project median beating the estimates', () => {
    expect(estimateRemark(accuracy({ within: 30, ratio: 2, baseline: { within: 45, within2: 70 } }))).toEqual({ kind: 'baseline' })
  })

  it('praises estimates mostly within ×1.5', () => {
    expect(estimateRemark(accuracy({ within: 70 }))).toEqual({ kind: 'sharp' })
  })

  it('names the optimist and the pessimist by the median ratio', () => {
    expect(estimateRemark(accuracy({ ratio: 1.6 }))).toEqual({ kind: 'optimist', ratio: 1.6 })
    expect(estimateRemark(accuracy({ ratio: 0.6 }))).toEqual({ kind: 'pessimist', ratio: 0.6 })
    expect(estimateRemark(accuracy({ ratio: 1.2 }))).toBeNull()
  })
})

describe('tasksRemark', () => {
  it('points at the task that ate a third of the money', () => {
    expect(tasksRemark([row('ABC-1', { cost: 40 }), row('ABC-2', { cost: 30 }), row('ABC-3', { cost: 30 })])).toEqual({
      kind: 'whale',
      task: 'ABC-1',
      share: 40,
    })
  })

  it('does not call the only task a whale', () => {
    expect(tasksRemark([row('ABC-1', { cost: 40 }), row('ABC-2', { cost: 30 })])).toBeNull()
  })

  it('otherwise points at the task with the most sessions', () => {
    const rows = [row('ABC-1', { sessions: 2 }), row('ABC-2', { sessions: 6 }), row('ABC-3', { sessions: 5 }), row('ABC-4')]
    expect(tasksRemark(rows)).toEqual({ kind: 'stubborn', task: 'ABC-2', sessions: 6 })
  })

  it('leaves calm tasks alone', () => {
    expect(tasksRemark([row('ABC-1'), row('ABC-2'), row('ABC-3'), row('ABC-4')])).toBeNull()
  })
})

describe('stuckRemark', () => {
  it('names the reason with the most spans over all weeks', () => {
    const weeks = [week('debug_loop', 2), week('waiting_user', 3), week('debug_loop', 2, '2026-10-12')]
    expect(stuckRemark(weeks)).toEqual({ reason: 'debug_loop' })
  })

  it('needs a few spans and a known reason', () => {
    expect(stuckRemark([week('debug_loop', 2)])).toBeNull()
    expect(stuckRemark([week(null, 5), week('normal', 1)])).toBeNull()
    expect(stuckRemark([week('something_new', 5)])).toBeNull()
  })
})
