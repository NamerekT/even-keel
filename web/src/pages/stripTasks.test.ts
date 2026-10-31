import { describe, expect, it } from 'vitest'
import type { StatsTaskRow } from '../../../src/stats/model.js'
import { stripTasks } from './stripTasks.js'

function task(id: string, fields: Partial<StatsTaskRow>): StatsTaskRow {
  return {
    task: id,
    project: 'ABC',
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

describe('stripTasks', () => {
  it('takes the three costliest tasks, the costliest first', () => {
    const rows = [task('ABC-1', { cost: 2 }), task('ABC-2', { cost: 9 }), task('ABC-3', { cost: 5 }), task('ABC-4', { cost: 7 })]
    expect(stripTasks(rows).top.map((row) => row.task)).toEqual(['ABC-2', 'ABC-4', 'ABC-3'])
  })

  it('leaves out tasks that cost nothing', () => {
    expect(stripTasks([task('ABC-1', { cost: 0 })]).top).toEqual([])
  })

  it('gives the median cost and active time of the finished tasks only', () => {
    const rows = [
      task('ABC-1', { cost: 1, activeS: 600 }),
      task('ABC-2', { cost: 3, activeS: 1200 }),
      task('ABC-3', { cost: 10, activeS: 3000 }),
      task('ABC-4', { cost: 50, activeS: 9000, done: false }),
    ]
    expect(stripTasks(rows).median).toEqual({ cost: 3, activeS: 1200, count: 3 })
  })

  it('averages the middle pair of an even count and skips tasks without active time for the time', () => {
    const rows = [task('ABC-1', { cost: 2, activeS: 600 }), task('ABC-2', { cost: 4, activeS: null })]
    expect(stripTasks(rows).median).toEqual({ cost: 3, activeS: 600, count: 2 })
  })

  it('has no median without a finished task', () => {
    expect(stripTasks([task('ABC-1', { done: false })]).median).toBeNull()
    expect(stripTasks([]).median).toBeNull()
  })
})
