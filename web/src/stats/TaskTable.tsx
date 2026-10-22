import type { TrackerUrls } from '../../../src/state.js'
import { Fragment, useState, type CSSProperties, type ReactNode } from 'react'
import type { StatsTaskDetail, StatsTaskRow } from '../../../src/stats/model.js'
import { folderEmail } from '../accounts.js'
import { formatMoment, formatTokens } from '../format.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { AccountTag } from '../ui/AccountTag.js'
import { seriesStyle } from '../ui/series.js'
import { Tipped } from '../ui/Tipped.js'
import { AnswerNotice, Section, TaskKey, loadedData, useStatsAnswer, type FoldControl } from './common.js'
import { formatDuration, formatRatio, formatSeconds, formatShare, formatUsd, kindLabel, launchLabel, modelLabel, reasonLabel } from './format.js'
import { tasksRemark, type TasksRemark } from './remarks.js'
import { compacts, compare, handoffs, shownColumns, type Column } from './taskColumns.js'

const FIRST_ROWS = 20

function remarkText(remark: TasksRemark | null): string | null {
  if (remark === null) return null
  return remark.kind === 'whale'
    ? t.stats.remarks.whale(remark.task, formatShare(remark.share))
    : t.stats.remarks.stubborn(remark.task, remark.sessions)
}

export function TaskTable({ tasks, trackerUrls, fold }: { tasks: StatsTaskRow[]; trackerUrls: TrackerUrls; fold: FoldControl }) {
  const [sort, setSort] = useState<{ column: Column; down: boolean }>({ column: 'cost', down: true })
  const [open, setOpen] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const columns = shownColumns(tasks)
  const rows = [...tasks].sort((a, b) => (sort.down ? -1 : 1) * compare(a, b, sort.column) || a.task.localeCompare(b.task))
  const shown = all ? rows : rows.slice(0, FIRST_ROWS)
  const top = Math.max(0, ...tasks.map((row) => row.cost))

  const sortBy = (column: Column, numeric: boolean) =>
    setSort(sort.column === column ? { column, down: !sort.down } : { column, down: numeric })

  const cell = (row: StatsTaskRow, column: Column): ReactNode => {
    switch (column) {
      case 'task':
        return (
          <td key={column} className="tasks__wide">
            <span className="tasks__task">
              <TaskKey id={row.task} trackerUrls={trackerUrls} url={row.url} />
              {row.title !== null && row.title !== '' && (
                <span className="tasks__title" title={row.title}>
                  {row.title}
                </span>
              )}
            </span>
          </td>
        )
      case 'project':
        return (
          <td key={column} className="tasks__project">
            {row.project}
          </td>
        )
      case 'status':
        return <td key={column}>{row.status !== null && <span className={row.done === true ? 'chip tasks__status tasks__status--done' : 'chip tasks__status'}>{row.status}</span>}</td>
      case 'cost':
        return (
          <td key={column} className="tasks__num tasks__cost" style={{ '--share': top > 0 ? row.cost / top : 0 } as CSSProperties}>
            {formatUsd(row.cost)}
          </td>
        )
      case 'limit':
        return (
          <td key={column} className="tasks__num">
            {row.limit === null ? '' : formatShare(row.limit)}
          </td>
        )
      case 'estimate':
        return (
          <td key={column} className="tasks__num">
            {row.estimateH === null ? '' : formatDuration(row.estimateH * 3600)}
          </td>
        )
      case 'active':
        return (
          <td key={column} className="tasks__num" title={timeTitle(row)}>
            {row.activeS === null ? '' : formatDuration(row.activeS)}
          </td>
        )
      case 'wait':
        return (
          <td key={column} className="tasks__num">
            {row.waitS ? formatDuration(row.waitS) : ''}
          </td>
        )
      case 'sessions':
        return (
          <td key={column} className="tasks__num">
            {row.sessions}
          </td>
        )
      case 'handoffs':
        return (
          <td key={column} className="tasks__num" title={handoffTitle(row)}>
            {handoffs(row) || ''}
          </td>
        )
      case 'compacts':
        return (
          <td key={column} className="tasks__num">
            {compacts(row) > 0 && (
              <Tipped tip={t.stats.tasks.compacts(row.compactsAuto, row.compactsManual)} inline>
                {compacts(row)}
              </Tipped>
            )}
          </td>
        )
      case 'spans':
        return (
          <td key={column} className={row.spans > 0 ? 'tasks__num tasks__num--warn' : 'tasks__num'}>
            {row.spans || ''}
          </td>
        )
      case 'rework':
        return (
          <td key={column} className="tasks__num tasks__num--warn">
            {row.rework ? t.stats.tasks.yes : ''}
          </td>
        )
    }
  }

  return (
    <Section title={t.stats.tasks.title} fold={fold} remark={remarkText(tasksRemark(tasks))} aside={<span className="stats-section__count">{tasks.length}</span>}>
      {tasks.length === 0 ? (
        <p className="placeholder">{t.stats.tasks.empty}</p>
      ) : (
        <div className="tasks__scroll">
          <table className="tasks tasks--list">
            <thead>
              <tr>
                {columns.map((column) => {
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
                    {columns.map((column) => cell(row, column.key))}
                  </tr>
                  {open === row.task && (
                    <tr className="tasks__detail">
                      <td colSpan={columns.length}>
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

const tokens = (count: number | null) => (count === null ? '?' : formatTokens(count))

function TaskDetail({ task }: { task: string }) {
  const { statsTask } = useLive()
  const loaded = useStatsAnswer(`task:${task}`, () => statsTask(task), false)
  const detail = loadedData(loaded)
  if (detail === null) return <AnswerNotice loaded={loaded} />
  return <Timeline detail={detail} />
}

function Timeline({ detail }: { detail: StatsTaskDetail }) {
  const { state } = useLive()
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
              {session.account !== null && <AccountTag email={folderEmail(state?.account, session.account)} />}
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
              {detail.compactions
                .filter((compaction) => compaction.sessionId === session.sessionId)
                .map((compaction) => (
                  <span key={compaction.at} className="timeline__compact" style={{ left: at(compaction.at) }}>
                    <Tipped
                      className="timeline__compact-hit"
                      tip={t.stats.tasks.compaction(compaction.trigger, tokens(compaction.preTokens), tokens(compaction.postTokens))}
                      align="start"
                      inline
                      focusable
                    >
                      <span className="timeline__compact-tick" />
                    </Tipped>
                  </span>
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
