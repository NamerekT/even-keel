import { describe, expect, it } from 'vitest'
import type { StatsTaskRow } from '../../../src/stats/model.js'
import { accuracy } from './accuracy.js'

function task(id: string, fields: Partial<StatsTaskRow>): StatsTaskRow {
  return {
    task: id,
    project: id.split('-')[0]!,
    title: null,
    status: 'Done',
    url: null,
    cost: 1,
    limit: null,
    sessions: 1,
    relays: 0,
    checkpoints: 0,
    restarts: 0,
    compactsAuto: 0,
    compactsManual: 0,
    spans: 0,
    rework: false,
    estimateH: null,
    activeS: null,
    waitS: null,
    totalS: null,
    done: true,
    component: null,
    model: null,
    ...fields,
  }
}

const hours = (count: number) => count * 3600

describe('accuracy', () => {
  it('compares only closed tasks with an estimate and counts the rest', () => {
    const result = accuracy([
      task('ABC-1', { estimateH: 1, activeS: hours(1.2) }),
      task('ABC-2', { estimateH: 2, activeS: hours(4) }),
      task('ABC-3', { activeS: hours(0.5) }),
      task('ABC-4', { estimateH: 1, activeS: hours(1), done: false }),
      task('ABC-5', { estimateH: 1, activeS: null }),
    ])
    expect(result.done).toBe(3)
    expect(result.compared).toBe(2)
    expect(result.unestimated).toBe(1)
    expect(result.open).toBe(1)
  })

  it('takes the median of the active time of closed tasks', () => {
    const result = accuracy([
      task('ABC-1', { activeS: 60 }),
      task('ABC-2', { activeS: 600 }),
      task('ABC-3', { activeS: 6000 }),
      task('ABC-4', { activeS: 100, done: false }),
    ])
    expect(result.medianS).toBe(600)
  })

  it('averages the two middle values of an even sample', () => {
    const result = accuracy([task('ABC-1', { estimateH: 1, activeS: hours(1) }), task('ABC-2', { estimateH: 1, activeS: hours(2) })])
    expect(result.ratio).toBe(1.5)
    expect(result.medianS).toBe(hours(1.5))
  })

  it('counts a task within ×1.5 of its estimate on both sides, bounds included', () => {
    const result = accuracy([
      task('ABC-1', { estimateH: 1, activeS: hours(1.5) }),
      task('ABC-2', { estimateH: 1.5, activeS: hours(1) }),
      task('ABC-3', { estimateH: 1, activeS: hours(1.6) }),
      task('ABC-4', { estimateH: 1, activeS: hours(0.6) }),
    ])
    expect(result.within).toBe(50)
  })

  it('counts a task within ×2 of its estimate on both sides, bounds included', () => {
    const result = accuracy([
      task('ABC-1', { estimateH: 1, activeS: hours(2) }),
      task('ABC-2', { estimateH: 2, activeS: hours(1) }),
      task('ABC-3', { estimateH: 1, activeS: hours(2.1) }),
      task('ABC-4', { estimateH: 1, activeS: hours(0.4) }),
    ])
    expect(result.within2).toBe(50)
  })

  it('scores the compared tasks against the median of the closed tasks of their project', () => {
    const result = accuracy([
      task('ABC-1', { estimateH: 1, activeS: hours(1) }),
      task('ABC-2', { estimateH: 1, activeS: hours(3) }),
      task('ABC-3', { activeS: hours(1) }),
      task('ABC-4', { activeS: hours(9), done: false }),
      task('XYZ-1', { estimateH: 1, activeS: hours(4) }),
    ])
    expect(result.baseline).toEqual({ within: (2 / 3) * 100, within2: (2 / 3) * 100 })
  })

  it('has no figures without a sample', () => {
    const result = accuracy([task('ABC-1', { activeS: null })])
    expect(result).toMatchObject({ done: 0, medianS: null, compared: 0, within: null, within2: null, baseline: null, ratio: null })
    expect(result.groups.project).toEqual([])
  })

  it('breaks the comparison down by project, component and model', () => {
    const result = accuracy([
      task('ABC-1', { estimateH: 1, activeS: hours(1), component: 'Web', model: 'opus' }),
      task('ABC-2', { estimateH: 1, activeS: hours(3), component: 'Web', model: 'sonnet' }),
      task('XYZ-1', { estimateH: 2, activeS: hours(1), model: 'opus' }),
      task('XYZ-2', { activeS: hours(1), component: 'Core', model: 'opus' }),
    ])
    expect(result.groups.project).toMatchObject([
      { key: 'ABC', tasks: 2, within: 50, ratio: 2 },
      { key: 'XYZ', tasks: 1, within: 0, ratio: 0.5 },
    ])
    expect(result.groups.component).toMatchObject([
      { key: 'Web', tasks: 2, within: 50, ratio: 2 },
      { key: null, tasks: 1, within: 0, ratio: 0.5 },
    ])
    expect(result.groups.model).toMatchObject([
      { key: 'opus', tasks: 2, within: 50, ratio: 0.75 },
      { key: 'sonnet', tasks: 1, within: 0, ratio: 3 },
    ])
  })

  it('gives each group its ×2 share and the constant baseline', () => {
    const result = accuracy([
      task('ABC-1', { estimateH: 1, activeS: hours(1), component: 'Web' }),
      task('ABC-2', { estimateH: 1, activeS: hours(2), component: 'Web' }),
      task('ABC-3', { estimateH: 1, activeS: hours(5), component: 'Core' }),
    ])
    expect(result.groups.component).toEqual([
      { key: 'Web', tasks: 2, within: 50, within2: 100, baseline: { within: 50, within2: 100 }, ratio: 1.5 },
      { key: 'Core', tasks: 1, within: 0, within2: 0, baseline: { within: 0, within2: 0 }, ratio: 5 },
    ])
  })
})
