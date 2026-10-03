import { describe, expect, it } from 'vitest'
import {
  bucketsOf,
  DEFAULT_STEP_SETTINGS,
  growthOf,
  measure,
  minus,
  parseStepSettings,
  quantile,
  shareOf,
  stepsOf,
  taskSteps,
  taskTime,
  weeksOf,
  type StepRunRow,
} from './steps.js'

const S = 1000

function run(seconds: number, extra: Partial<StepRunRow> = {}): StepRunRow {
  return { step: 'vitest', task: 'BTN-1', week: '2026-09-28', startedAt: 0, endedAt: seconds * S, seconds, cold: false, outcome: 'ok', current: true, ...extra }
}

describe('quantile', () => {
  it('interpolates like percentile_cont', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.9)).toBe(91)
    expect(quantile([7], 0.9)).toBe(7)
  })
})

describe('bucketsOf', () => {
  it('puts runs into eight buckets by upper bound', () => {
    expect(bucketsOf([0.5, 3, 9.9, 29, 59, 61, 119, 299, 599, 600, 4000])).toEqual([1, 2, 1, 1, 2, 1, 1, 2])
  })
})

describe('intervals', () => {
  it('measures a union in seconds', () => {
    expect(measure([{ from: 0, to: 10 * S }, { from: 5 * S, to: 15 * S }, { from: 20 * S, to: 21 * S }])).toBe(16)
  })

  it('cuts holes out of intervals', () => {
    expect(minus([{ from: 0, to: 100 }], [{ from: 10, to: 20 }, { from: 50, to: 200 }])).toEqual([
      { from: 0, to: 10 },
      { from: 20, to: 50 },
    ])
  })
})

describe('taskTime', () => {
  it('adds runs outside turns to the active time and merges overlapping runs of a step', () => {
    const runs = [
      { step: 'unity-check', startedAt: 0, endedAt: 600 * S },
      { step: 'unity-check', startedAt: 100 * S, endedAt: 200 * S },
      { step: 'vitest', startedAt: 700 * S, endedAt: 710 * S },
    ]
    const time = taskTime(runs, [{ from: 0, to: 60 * S }, { from: 650 * S, to: 800 * S }], 300)
    expect(time.base).toBe(300 + 540)
    expect(taskSteps(time)).toEqual([
      { step: 'unity-check', runs: 2, seconds: 600, share: 600 / 840 },
      { step: 'vitest', runs: 1, seconds: 10, share: 10 / 840 },
    ])
  })

  it('has no share without time', () => {
    expect(taskSteps(taskTime([{ step: 'build', startedAt: 0, endedAt: 0 }], [], 0))).toEqual([{ step: 'build', runs: 1, seconds: 0, share: null }])
  })

  it('caps a share at the whole', () => {
    const time = taskTime([{ step: 'build', startedAt: 0, endedAt: 100 * S }], [{ from: 0, to: 100 * S }], 30)
    expect(taskSteps(time)[0]!.share).toBe(1)
  })

  it('sums shares over tasks', () => {
    const one = taskTime([{ step: 'build', startedAt: 0, endedAt: 10 * S }], [{ from: 0, to: 10 * S }], 100)
    const two = taskTime([{ step: 'vitest', startedAt: 0, endedAt: 30 * S }], [{ from: 0, to: 30 * S }], 100)
    expect(shareOf([one, two])).toEqual(new Map([['build', 0.05], ['vitest', 0.15]]))
  })
})

describe('weeksOf', () => {
  const growth = DEFAULT_STEP_SETTINGS.growth

  it('flags a week whose p90 grew against the previous week with runs', () => {
    const runs = [
      ...[30, 31, 32, 33, 35].map((s) => run(s, { week: '2026-09-14' })),
      ...[30, 32, 34, 100, 180].map((s) => run(s, { week: '2026-09-28' })),
    ]
    const weeks = weeksOf(runs, growth)
    expect(weeks.map((week) => [week.week, week.grewP50, week.grewP90])).toEqual([
      ['2026-09-14', false, false],
      ['2026-09-28', false, true],
    ])
    expect(growthOf(weeks, new Set(['2026-09-28']))).toEqual([{ week: '2026-09-28', quantile: 'p90', from: weeks[0]!.p90, to: weeks[1]!.p90 }])
  })

  it('needs enough runs on both sides and a big enough step in seconds', () => {
    const few = [run(1, { week: 'a' }), run(100, { week: 'b' })]
    expect(weeksOf(few, growth).some((week) => week.grewP90)).toBe(false)
    const small = [...[1, 1, 1, 1, 1].map((s) => run(s, { week: 'a' })), ...[3, 3, 3, 3, 3].map((s) => run(s, { week: 'b' }))]
    expect(weeksOf(small, growth).some((week) => week.grewP50 || week.grewP90)).toBe(false)
  })
})

describe('stepsOf', () => {
  it('splits cold and warm runs, outcomes and slow share for the current period only', () => {
    const runs = [
      run(200, { step: 'unity-check', cold: true }),
      run(20, { step: 'unity-check', outcome: 'fail' }),
      run(30, { step: 'unity-check', outcome: null }),
      run(40, { step: 'unity-check', current: false }),
      run(2),
    ]
    const [check, vitest] = stepsOf(runs, DEFAULT_STEP_SETTINGS, new Map([['unity-check', 0.4]]))
    expect(check).toMatchObject({
      step: 'unity-check',
      n: 3,
      p50: 30,
      max: 200,
      total: 250,
      slow: 1 / 3,
      cold: { n: 1, p50: 200 },
      warm: { n: 2, p50: 25 },
      outcomes: { ok: 1, fail: 1, timeout: 0, killed: 0, unknown: 1 },
      share: 0.4,
    })
    expect(check!.weeks[0]!.n).toBe(4)
    expect(vitest).toMatchObject({ step: 'vitest', n: 1, share: null, cold: { n: 0, p50: null } })
  })
})

describe('parseStepSettings', () => {
  it('takes known numbers over defaults', () => {
    expect(parseStepSettings({ slowSeconds: 30, growth: { ratio: 2, minRuns: 'x' } })).toEqual({
      slowSeconds: 30,
      growth: { ratio: 2, minRuns: 5, minSeconds: 10 },
    })
    expect(parseStepSettings(null)).toEqual(DEFAULT_STEP_SETTINGS)
  })
})
