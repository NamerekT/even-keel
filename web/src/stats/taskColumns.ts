import type { StatsTaskRow } from '../../../src/stats/model.js'
import { language } from '../i18n/index.js'

export type Column = 'task' | 'project' | 'status' | 'cost' | 'limit' | 'estimate' | 'active' | 'wait' | 'sessions' | 'handoffs' | 'spans' | 'rework'

export interface TaskColumn {
  key: Column
  numeric: boolean
}

export const COLUMNS: TaskColumn[] = [
  { key: 'task', numeric: false },
  { key: 'project', numeric: false },
  { key: 'status', numeric: false },
  { key: 'cost', numeric: true },
  { key: 'limit', numeric: true },
  { key: 'estimate', numeric: true },
  { key: 'active', numeric: true },
  { key: 'wait', numeric: true },
  { key: 'sessions', numeric: true },
  { key: 'handoffs', numeric: true },
  { key: 'spans', numeric: true },
  { key: 'rework', numeric: true },
]

export const handoffs = (row: StatsTaskRow) => row.relays + row.checkpoints + row.restarts

function value(row: StatsTaskRow, column: Column): string | number {
  switch (column) {
    case 'task':
      return row.task
    case 'project':
      return row.project
    case 'status':
      return row.status ?? ''
    case 'limit':
      return row.limit ?? -1
    case 'estimate':
      return row.estimateH ?? -1
    case 'active':
      return row.activeS ?? -1
    case 'wait':
      return row.waitS ?? -1
    case 'handoffs':
      return handoffs(row)
    case 'rework':
      return row.rework ? 1 : 0
    default:
      return row[column]
  }
}

export function compare(a: StatsTaskRow, b: StatsTaskRow, column: Column): number {
  const left = value(a, column)
  const right = value(b, column)
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), language, { numeric: true })
}

function filled(row: StatsTaskRow, column: Column): boolean {
  switch (column) {
    case 'task':
    case 'cost':
    case 'sessions':
      return true
    case 'status':
      return row.status !== null && row.status !== ''
    case 'limit':
      return row.limit !== null
    case 'estimate':
      return row.estimateH !== null
    case 'active':
      return row.activeS !== null
    case 'wait':
      return (row.waitS ?? 0) > 0
    case 'handoffs':
      return handoffs(row) > 0
    case 'spans':
      return row.spans > 0
    case 'rework':
      return row.rework
    case 'project':
      return true
  }
}

/** A column stays only when some task has a value in it; the project — when the tasks come from several. */
export function shownColumns(rows: StatsTaskRow[]): TaskColumn[] {
  const projects = new Set(rows.map((row) => row.project))
  return COLUMNS.filter((column) => (column.key === 'project' ? projects.size > 1 : rows.some((row) => filled(row, column.key))))
}
