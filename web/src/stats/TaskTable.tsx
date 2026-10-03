import { Fragment, useState } from 'react'
import type { StatsTaskDetail, StatsTaskRow } from '../../../src/stats/model.js'
import { formatMoment } from '../format.js'
import { useLive } from '../live/context.js'
import { seriesStyle } from '../ui/series.js'
import { AnswerNotice, Section, TaskKey, loadedData, useStatsAnswer } from './common.js'
import { formatShare, formatUsd, kindLabel, launchLabel, modelLabel, reasonLabel } from './format.js'

type Column = 'task' | 'project' | 'status' | 'cost' | 'limit' | 'sessions' | 'handoffs' | 'spans' | 'rework'

const FIRST_ROWS = 50

const COLUMNS: { key: Column; label: string; numeric: boolean; title?: string }[] = [
  { key: 'task', label: 'Задача', numeric: false },
  { key: 'project', label: 'Проект', numeric: false },
  { key: 'status', label: 'Статус', numeric: false },
  { key: 'cost', label: '$', numeric: true, title: 'Деньги по ценам API' },
  { key: 'limit', label: 'Лимит', numeric: true, title: 'Доля недельного лимита' },
  { key: 'sessions', label: 'Сессии', numeric: true },
  { key: 'handoffs', label: 'Передачи', numeric: true, title: 'Передачи по лимиту, контрольные точки и замены вручную' },
  { key: 'spans', label: 'Застревания', numeric: true },
  { key: 'rework', label: 'Переделка', numeric: true },
]

const handoffs = (row: StatsTaskRow) => row.relays + row.checkpoints + row.restarts

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
    case 'handoffs':
      return handoffs(row)
    case 'rework':
      return row.rework ? 1 : 0
    default:
      return row[column]
  }
}

function compare(a: StatsTaskRow, b: StatsTaskRow, column: Column): number {
  const left = value(a, column)
  const right = value(b, column)
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), 'ru', { numeric: true })
}

export function TaskTable({ tasks, trackerUrl }: { tasks: StatsTaskRow[]; trackerUrl: string | null }) {
  const [sort, setSort] = useState<{ column: Column; down: boolean }>({ column: 'cost', down: true })
  const [open, setOpen] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const rows = [...tasks].sort((a, b) => (sort.down ? -1 : 1) * compare(a, b, sort.column) || a.task.localeCompare(b.task))
  const shown = all ? rows : rows.slice(0, FIRST_ROWS)

  const sortBy = (column: Column, numeric: boolean) =>
    setSort(sort.column === column ? { column, down: !sort.down } : { column, down: numeric })

  return (
    <Section title="Задачи" aside={<span className="stats-section__note">{tasks.length}</span>}>
      {tasks.length === 0 ? (
        <p className="placeholder">Задач с расходом за период нет.</p>
      ) : (
        <div className="tasks__scroll">
          <table className="tasks">
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.numeric ? 'tasks__num' : undefined}
                    aria-sort={sort.column === column.key ? (sort.down ? 'descending' : 'ascending') : 'none'}
                  >
                    <button type="button" className="tasks__sort" title={column.title} onClick={() => sortBy(column.key, column.numeric)}>
                      {column.label}
                      {sort.column === column.key && <span aria-hidden="true">{sort.down ? ' ↓' : ' ↑'}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <Fragment key={row.task}>
                  <tr
                    className={open === row.task ? 'tasks__row tasks__row--open' : 'tasks__row'}
                    tabIndex={0}
                    aria-expanded={open === row.task}
                    onClick={() => setOpen(open === row.task ? null : row.task)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setOpen(open === row.task ? null : row.task)
                      }
                    }}
                  >
                    <td>
                      <span className="tasks__task">
                        <TaskKey id={row.task} trackerUrl={trackerUrl} />
                        {row.title !== null && row.title !== '' && <span className="tasks__title">{row.title}</span>}
                      </span>
                    </td>
                    <td className="tasks__project">{row.project}</td>
                    <td>{row.status !== null && <span className="chip">{row.status}</span>}</td>
                    <td className="tasks__num">{formatUsd(row.cost)}</td>
                    <td className="tasks__num">{formatShare(row.limit)}</td>
                    <td className="tasks__num">{row.sessions}</td>
                    <td className="tasks__num" title={handoffTitle(row)}>
                      {handoffs(row) || ''}
                    </td>
                    <td className="tasks__num">{row.spans || ''}</td>
                    <td className="tasks__num">{row.rework ? 'да' : ''}</td>
                  </tr>
                  {open === row.task && (
                    <tr className="tasks__detail">
                      <td colSpan={COLUMNS.length}>
                        <TaskDetail task={row.task} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {rows.length > FIRST_ROWS && (
            <button type="button" className="link-button tasks__more" onClick={() => setAll(!all)}>
              {all ? `Показать первые ${FIRST_ROWS}` : `Показать все (${rows.length})`}
            </button>
          )}
        </div>
      )}
    </Section>
  )
}

function handoffTitle(row: StatsTaskRow): string {
  return `по лимиту: ${row.relays}, контрольные точки: ${row.checkpoints}, вручную: ${row.restarts}`
}

function TaskDetail({ task }: { task: string }) {
  const { statsTask } = useLive()
  const loaded = useStatsAnswer(`task:${task}`, () => statsTask(task), false)
  const detail = loadedData(loaded)
  if (detail === null) return <AnswerNotice loaded={loaded} />
  return <Timeline detail={detail} />
}

function Timeline({ detail }: { detail: StatsTaskDetail }) {
  const now = new Date()
  const times = [...detail.sessions.flatMap((each) => [each.firstAt, each.lastAt]), ...detail.spans.flatMap((each) => [each.fromAt, each.toAt])].map(Date.parse)
  if (times.length === 0) return <p className="placeholder">Сессий по задаче нет.</p>
  const start = Math.min(...times)
  const length = Math.max(Math.max(...times) - start, 60_000)
  const at = (moment: string) => `${((Date.parse(moment) - start) / length) * 100}%`
  const width = (from: string, to: string) => `max(3px, ${((Date.parse(to) - Date.parse(from)) / length) * 100}%)`

  return (
    <div className="timeline">
      <div className="timeline__axis">
        <span>{formatMoment(new Date(start).toISOString(), now)}</span>
        <span>{formatMoment(new Date(start + length).toISOString(), now)}</span>
      </div>
      <ul className="timeline__rows">
        {detail.sessions.map((session, index) => (
          <li key={session.sessionId} className="timeline__row">
            <span className="timeline__label" title={session.title ?? session.sessionId}>
              {launchLabel(session.reason)}
              <span className="timeline__meta">
                {session.model !== null && modelLabel(session.model.replace(/^claude-([a-z]+).*$/, '$1'))} · {formatUsd(session.cost)}
              </span>
            </span>
            <span className="timeline__track">
              <span className="timeline__bar" style={{ ...seriesStyle((index % 8) + 1), left: at(session.firstAt), width: width(session.firstAt, session.lastAt) }} />
              {detail.spans
                .filter((span) => span.sessionId === session.sessionId)
                .map((span) => (
                  <span
                    key={span.id}
                    className="timeline__span"
                    style={{ left: at(span.fromAt), width: width(span.fromAt, span.toAt) }}
                    title={`${reasonLabel(span.reason)}: ${span.kinds.map(kindLabel).join(', ')}`}
                  />
                ))}
            </span>
          </li>
        ))}
      </ul>
      {detail.spans.length > 0 && (
        <ul className="stuck-list">
          {detail.spans.map((span) => (
            <li key={span.id} className="stuck-list__item">
              <span className="stuck-list__head">
                <span className="stuck-list__when">{formatMoment(span.toAt, now)}</span>
                <span className="stuck-list__kinds">{span.kinds.map(kindLabel).join(', ')}</span>
              </span>
              <span className="stuck-list__facts">
                <strong>{reasonLabel(span.reason)}</strong>
                {span.note !== null && span.note !== '' && ` — ${span.note}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
