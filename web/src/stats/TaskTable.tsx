import type { TrackerUrls } from '../../../src/state.js'
import { Fragment, useState } from 'react'
import type { StatsTaskDetail, StatsTaskRow } from '../../../src/stats/model.js'
import { formatMoment } from '../format.js'
import { language, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { seriesStyle } from '../ui/series.js'
import { AnswerNotice, Section, TaskKey, loadedData, useStatsAnswer } from './common.js'
import { formatDuration, formatRatio, formatSeconds, formatShare, formatUsd, kindLabel, launchLabel, modelLabel, reasonLabel } from './format.js'

type Column = 'task' | 'project' | 'status' | 'cost' | 'limit' | 'estimate' | 'active' | 'wait' | 'sessions' | 'handoffs' | 'spans' | 'rework'

const FIRST_ROWS = 50

const COLUMNS: { key: Column; numeric: boolean }[] = [
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

function compare(a: StatsTaskRow, b: StatsTaskRow, column: Column): number {
  const left = value(a, column)
  const right = value(b, column)
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), language, { numeric: true })
}

export function TaskTable({ tasks, trackerUrls }: { tasks: StatsTaskRow[]; trackerUrls: TrackerUrls }) {
  const [sort, setSort] = useState<{ column: Column; down: boolean }>({ column: 'cost', down: true })
  const [open, setOpen] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const rows = [...tasks].sort((a, b) => (sort.down ? -1 : 1) * compare(a, b, sort.column) || a.task.localeCompare(b.task))
  const shown = all ? rows : rows.slice(0, FIRST_ROWS)

  const sortBy = (column: Column, numeric: boolean) =>
    setSort(sort.column === column ? { column, down: !sort.down } : { column, down: numeric })

  return (
    <Section title={t.stats.tasks.title} aside={<span className="stats-section__note">{tasks.length}</span>}>
      {tasks.length === 0 ? (
        <p className="placeholder">{t.stats.tasks.empty}</p>
      ) : (
        <div className="tasks__scroll">
          <table className="tasks">
            <thead>
              <tr>
                {COLUMNS.map((column) => {
                  const [label, title] = t.stats.tasks.columns[column.key]!
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      className={column.numeric ? 'tasks__num' : undefined}
                      aria-sort={sort.column === column.key ? (sort.down ? 'descending' : 'ascending') : 'none'}
                    >
                      <button type="button" className="tasks__sort" title={title} onClick={() => sortBy(column.key, column.numeric)}>
                        {label}
                        {sort.column === column.key && <span aria-hidden="true">{sort.down ? ' ↓' : ' ↑'}</span>}
                      </button>
                    </th>
                  )
                })}
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
                        <TaskKey id={row.task} trackerUrls={trackerUrls} />
                        {row.title !== null && row.title !== '' && <span className="tasks__title">{row.title}</span>}
                      </span>
                    </td>
                    <td className="tasks__project">{row.project}</td>
                    <td>{row.status !== null && <span className="chip">{row.status}</span>}</td>
                    <td className="tasks__num">{formatUsd(row.cost)}</td>
                    <td className="tasks__num">{formatShare(row.limit)}</td>
                    <td className="tasks__num">{row.estimateH === null ? '' : formatDuration(row.estimateH * 3600)}</td>
                    <td className="tasks__num" title={timeTitle(row)}>
                      {row.activeS === null ? '' : formatDuration(row.activeS)}
                    </td>
                    <td className="tasks__num">{row.waitS ? formatDuration(row.waitS) : ''}</td>
                    <td className="tasks__num">{row.sessions}</td>
                    <td className="tasks__num" title={handoffTitle(row)}>
                      {handoffs(row) || ''}
                    </td>
                    <td className="tasks__num">{row.spans || ''}</td>
                    <td className="tasks__num">{row.rework ? t.stats.tasks.yes : ''}</td>
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
              {all ? t.stats.tasks.first(FIRST_ROWS) : t.stats.tasks.all(rows.length)}
            </button>
          )}
        </div>
      )}
    </Section>
  )
}

function timeTitle(row: StatsTaskRow): string | undefined {
  if (row.activeS === null) return undefined
  const ratio = row.estimateH === null ? '' : t.stats.tasks.ofEstimate(formatRatio(row.activeS / 3600 / row.estimateH))
  return `${t.stats.tasks.total(formatDuration(row.totalS))}${ratio}${row.done === true ? '' : t.stats.tasks.open}`
}

function handoffTitle(row: StatsTaskRow): string {
  return t.stats.tasks.handoffs(row.relays, row.checkpoints, row.restarts)
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
  if (times.length === 0) return <p className="placeholder">{t.stats.tasks.noSessions}</p>
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
      {detail.steps.length > 0 && (
        <p className="task-steps">
          {t.stats.tasks.steps}{' '}
          {detail.steps.map((step, index) => (
            <span key={step.step} title={`${t.stats.tasks.launches(step.runs)}, ${formatSeconds(step.seconds)}`}>
              {index > 0 && ' · '}
              <code>{step.step}</code> {step.share === null ? formatSeconds(step.seconds) : formatShare(step.share * 100)}
            </span>
          ))}
          <span className="task-steps__note">{t.stats.tasks.stepsNote}</span>
        </p>
      )}
    </div>
  )
}
