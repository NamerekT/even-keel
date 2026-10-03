import { useEffect, useState, type ReactNode } from 'react'
import type { ProjectStats, StatsAnswer, StatsDays, StatsQuery, StatsRepeat, StatsScope, StatsStuck } from '../../../src/stats/model.js'
import { formatMoment, plural } from '../format.js'
import { useLive } from '../live/context.js'
import { issueLink } from '../state.js'
import { costChange, formatShare, formatUsd, kindLabel, reasonLabel } from './stats.js'

const REFRESH_MS = 5 * 60_000
const DAYS: StatsDays[] = [7, 30]
const SCOPES: [StatsScope, string][] = [
  ['all', 'Все сессии'],
  ['chain', 'Цепочка'],
]

type Loaded = { query: StatsQuery; answer: StatsAnswer } | { query: StatsQuery; failure: string }

export function StatsPanel({ project, trackerUrl }: { project: string; trackerUrl: string | null }) {
  const { stats } = useLive()
  const [query, setQuery] = useState<StatsQuery>({ days: 7, scope: 'all' })
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      stats(project, query).then(
        (answer) => alive && setLoaded({ query, answer }),
        (reason: unknown) => alive && setLoaded({ query, failure: reason instanceof Error ? reason.message : String(reason) }),
      )
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [project, query.days, query.scope])

  const fresh = loaded !== null && loaded.query.days === query.days && loaded.query.scope === query.scope

  return (
    <section className="stats" aria-labelledby="stats-title" aria-busy={!fresh}>
      <header className="stats__head">
        <h2 id="stats-title" className="stats__title">
          Расход
        </h2>
        <div className="stats__filters">
          <Segmented
            label="Период"
            options={DAYS.map((days) => [days, `${days} дней`])}
            value={query.days}
            onChange={(days) => setQuery({ ...query, days })}
          />
          <Segmented label="Сессии" options={SCOPES} value={query.scope} onChange={(scope) => setQuery({ ...query, scope })} />
        </div>
      </header>
      {loaded === null ? (
        <p className="placeholder">Читаю статистику…</p>
      ) : 'failure' in loaded ? (
        <p className="notice notice--error">Батон не ответил: {loaded.failure}</p>
      ) : loaded.answer.state === 'off' ? (
        <p className="notice notice--warn">Статистика Tally выключена: {loaded.answer.reason}.</p>
      ) : loaded.answer.state === 'error' ? (
        <p className="notice notice--error">База Tally недоступна: {loaded.answer.error}</p>
      ) : (
        <StatsBody stats={loaded.answer.stats} trackerUrl={trackerUrl} />
      )}
    </section>
  )
}

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: [T, string][]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          className={option === value ? 'segmented__item segmented__item--on' : 'segmented__item'}
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

function StatsBody({ stats, trackerUrl }: { stats: ProjectStats; trackerUrl: string | null }) {
  const { total, query } = stats
  const change = costChange(total.cost, total.previousCost)
  const now = new Date()
  const task = (id: string) => <TaskKey id={id} trackerUrl={trackerUrl} />

  return (
    <>
      <div className="stats__tiles">
        <Tile label="По ценам API" value={formatUsd(total.cost)}>
          {change === null ? 'прошлого периода нет' : `${change} к прошлым ${query.days} дням`}
        </Tile>
        <Tile label="Недельный лимит" value={formatShare(total.sevenDay)}>
          {total.sevenDay === null ? 'снимков лимита за период нет' : `5 ч: ${formatShare(total.fiveHour)} — оценка по снимкам`}
        </Tile>
        <Tile label="Сессии" value={String(total.sessions)}>
          {total.messages.toLocaleString('ru')} {plural(total.messages, 'ответ', 'ответа', 'ответов')}
          {total.unpriced > 0 && `, ${total.unpriced} без цены`}
        </Tile>
      </div>

      <StatsSection title="Самые дорогие задачи" empty={stats.tasks.length === 0 && stats.service.sessions === 0} emptyText="Расхода за период нет.">
        <table className="stats__table">
          <thead>
            <tr>
              <th scope="col">Задача</th>
              <th scope="col" className="stats__num">
                Сессии
              </th>
              <th scope="col" className="stats__num">
                Лимит 7 д
              </th>
              <th scope="col" className="stats__num">
                Деньги
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.tasks.map((row) => (
              <tr key={row.task}>
                <td>
                  <TaskTitle id={task(row.task)} title={row.title} status={row.status} />
                </td>
                <td className="stats__num">{row.sessions}</td>
                <td className="stats__num">{formatShare(row.sevenDay)}</td>
                <td className="stats__num">{formatUsd(row.cost)}</td>
              </tr>
            ))}
            {stats.service.sessions > 0 && (
              <tr className="stats__service">
                <td>
                  <span className="stats__task-title">Без задачи — служебные сессии в папке проекта</span>
                </td>
                <td className="stats__num">{stats.service.sessions}</td>
                <td className="stats__num" />
                <td className="stats__num">{formatUsd(stats.service.cost)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </StatsSection>

      <StatsSection title="Повторы" empty={stats.repeats.length === 0} emptyText="Задач с несколькими сессиями или переделкой за период нет.">
        <ul className="stats__list">
          {stats.repeats.map((row) => (
            <li key={row.task} className="stats__item">
              <TaskTitle id={task(row.task)} title={row.title} status={row.status} />
              <span className="stats__facts">{repeatFacts(row)}</span>
            </li>
          ))}
        </ul>
      </StatsSection>

      <StatsSection title="Застревания" empty={stats.stuck.length === 0} emptyText="Сессии за период не топтались на месте.">
        <ul className="stats__reasons">
          {stats.reasons.map((row) => (
            <li key={row.reason ?? ''} className={row.reason === null ? 'chip' : 'chip chip--paused'}>
              {reasonLabel(row.reason)}: {row.spans}
            </li>
          ))}
        </ul>
        <ul className="stats__list">
          {stats.stuck.map((row) => (
            <StuckItem key={row.id} row={row} task={row.task === null ? null : task(row.task)} now={now} />
          ))}
        </ul>
      </StatsSection>

      <p className="stats__foot">
        Tally, с {formatMoment(stats.since, now)} · прочитано {formatMoment(stats.at, now)}
      </p>
    </>
  )
}

function Tile({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="stats__tile">
      <span className="stats__tile-label">{label}</span>
      <span className="stats__tile-value">{value}</span>
      <span className="stats__tile-note">{children}</span>
    </div>
  )
}

function StatsSection({ title, empty, emptyText, children }: { title: string; empty: boolean; emptyText: string; children: ReactNode }) {
  return (
    <div className="stats__section">
      <h3 className="stats__subtitle">{title}</h3>
      {empty ? <p className="placeholder">{emptyText}</p> : children}
    </div>
  )
}

function TaskKey({ id, trackerUrl }: { id: string; trackerUrl: string | null }) {
  const link = issueLink(trackerUrl, id)
  return link === null ? (
    <span className="stats__key">{id}</span>
  ) : (
    <a className="stats__key" href={link} target="_blank" rel="noreferrer">
      {id}
    </a>
  )
}

function TaskTitle({ id, title, status }: { id: ReactNode; title: string | null; status: string | null }) {
  return (
    <span className="stats__task">
      {id}
      {title !== null && title !== '' && <span className="stats__task-title">{title}</span>}
      {status !== null && <span className="chip">{status}</span>}
    </span>
  )
}

function StuckItem({ row, task, now }: { row: StatsStuck; task: ReactNode; now: Date }) {
  return (
    <li className="stats__item">
      <span className="stats__task">
        {task ?? <span className="stats__key stats__key--none">без задачи</span>}
        <span className="stats__when">{formatMoment(row.toAt, now)}</span>
        <span className="stats__kinds">{row.kinds.map(kindLabel).join(', ')}</span>
      </span>
      <span className="stats__facts">
        <strong>{reasonLabel(row.reason)}</strong>
        {row.note !== null && row.note !== '' && ` — ${row.note}`}
      </span>
    </li>
  )
}

function repeatFacts(row: StatsRepeat): string {
  const parts = [`${row.sessions} ${plural(row.sessions, 'сессия', 'сессии', 'сессий')}`]
  if (row.checkpoints > 0) parts.push(`контрольных точек: ${row.checkpoints}`)
  if (row.relays > 0) parts.push(`передач по лимиту: ${row.relays}`)
  if (row.restarts > 0) parts.push(`замен вручную: ${row.restarts}`)
  if (row.spans > 0) parts.push(`застреваний: ${row.spans}`)
  if (row.rework) parts.push('переделка')
  return parts.join(' · ')
}
