import { describe, expect, it } from 'vitest'
import type { StatsTaskRow } from '../../../src/stats/model.js'
import { shownColumns } from './taskColumns.js'

function task(id: string, fields: Partial<StatsTaskRow> = {}): StatsTaskRow {
  return {
    task: id,
    project: id.split('-')[0]!,
    title: null,
    status: 'Done',
    cost: 1,
    limit: null,
    sessions: 1,
    relays: 0,
    checkpoints: 0,
    restarts: 0,
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

const keys = (rows: StatsTaskRow[]) => shownColumns(rows).map((column) => column.key)

describe('shownColumns', () => {
  it('leaves out the columns no task has a value for and the project of a single project', () => {
    expect(keys([task('ABC-1'), task('ABC-2')])).toEqual(['task', 'status', 'cost', 'sessions'])
  })

  it('shows the project once the tasks come from several', () => {
    expect(keys([task('ABC-1'), task('OPS-2')])).toContain('project')
  })

  it('shows a column as soon as one task fills it', () => {
    const rows = [
      task('ABC-1'),
      task('ABC-2', { limit: 3, estimateH: 1, activeS: 600, waitS: 60, checkpoints: 1, spans: 2, rework: true }),
    ]
    expect(keys(rows)).toEqual(['task', 'status', 'cost', 'limit', 'estimate', 'active', 'wait', 'sessions', 'handoffs', 'spans', 'rework'])
  })

  it('does not count a zero wait or an empty status as a value', () => {
    expect(keys([task('ABC-1', { waitS: 0, status: null })])).toEqual(['task', 'cost', 'sessions'])
  })
})
