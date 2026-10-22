import { useSearchParams } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import type { TrackerView } from '../../../src/tracker/health.js'
import { formatAgo } from '../format.js'
import { t } from '../i18n/index.js'
import { useChecks } from '../layout/Status.js'
import type { Check } from '../layout/system.js'
import { useNow } from '../layout/useNow.js'
import { HelpTip } from './settingsParts.js'
import './settings.css'
import './status.css'

const CLOCK_MS = 5_000

/**
 * `/status` (BTN-66): the checks and the tracker connections at the left, one per profile in use; at the right the one
 * picked (`?item=`), by default the first that is not fine.
 */
export function StatusPage({ state }: { state: EvenKeelState }) {
  const now = useNow(CLOCK_MS)
  const { checks, stale, retryNow } = useChecks(now)
  const [params, setParams] = useSearchParams()
  const plain = checks.filter((check) => check.tracker === undefined)
  const connections = checks.filter((check) => check.tracker !== undefined)
  const shown = checks.find((check) => check.key === params.get('item')) ?? checks.find((check) => check.level === 'error' || check.level === 'warn') ?? checks[0]!
  const pick = (key: string) => setParams((current) => (current.set('item', key), current), { replace: true })

  return (
    <div className="page settings-page status-page">
      <header>
        <h1 className="page__title settings-page__title">
          {t.statusPage.title}
          <HelpTip text={t.statusPage.hint} />
        </h1>
      </header>
      <div className="settings-page__body">
        <nav className="status-nav" aria-label={t.statusPage.title}>
          <CheckGroup title={t.statusPage.checks} checks={plain} shown={shown.key} onPick={pick} />
          <CheckGroup title={t.statusPage.connections} checks={connections} shown={shown.key} onPick={pick} empty={t.statusPage.noConnections} />
        </nav>
        <section key={shown.key} className={`settings-page__form status-detail system__row--${shown.level}`} aria-labelledby="status-item">
          <h2 id="status-item" className="settings-page__group status-detail__head">
            <span className="system__dot" aria-hidden="true" />
            {shown.name}
          </h2>
          {shown.tracker === undefined ? (
            <>
              <p className="status-detail__text">{shown.text}</p>
              {shown.details.map((detail) => (
                <p key={detail} className="status-detail__note">
                  {detail}
                </p>
              ))}
              {shown.key === 'server' && stale && (
                <button type="button" className="button system__retry" onClick={retryNow}>
                  {t.common.retry}
                </button>
              )}
            </>
          ) : (
            <Connection state={state} check={shown} tracker={shown.tracker} now={now} />
          )}
        </section>
      </div>
    </div>
  )
}

function CheckGroup({ title, checks, shown, onPick, empty }: { title: string; checks: Check[]; shown: string; onPick: (key: string) => void; empty?: string }) {
  return (
    <div className="status-nav__group">
      <h2 className="status-nav__title">{title}</h2>
      {checks.length === 0 && empty !== undefined ? (
        <p className="status-nav__empty">{empty}</p>
      ) : (
        <ul className="settings-nav__list">
          {checks.map((check) => (
            <li key={check.key} className={`system__row--${check.level}`}>
              <button type="button" className="settings-nav__item status-nav__item" aria-current={check.key === shown ? 'true' : undefined} onClick={() => onPick(check.key)}>
                <span className="system__dot" aria-hidden="true" />
                <span className="settings-nav__title">{check.name}</span>
                <span className="status-nav__text">{check.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Connection({ state, check, tracker, now }: { state: EvenKeelState; check: Check; tracker: TrackerView; now: Date }) {
  const { health } = tracker
  return (
    <>
      <dl className="status-facts">
        <dt>{t.statusPage.link}</dt>
        <dd>{check.text}</dd>
        <dt>{t.statusPage.lastOk}</dt>
        <dd>{health.lastOkAt === null ? t.statusPage.never : formatAgo(health.lastOkAt, now)}</dd>
        {health.error !== null && (
          <>
            <dt>{t.statusPage.error}</dt>
            <dd className="status-facts__error">{health.error}</dd>
          </>
        )}
      </dl>
      <table className="status-projects">
        <caption>{t.statusPage.projects}</caption>
        <thead>
          <tr>
            <th scope="col">{t.statusPage.project}</th>
            <th scope="col">{t.statusPage.readAt}</th>
          </tr>
        </thead>
        <tbody>
          {tracker.projects.map((reader) => {
            const read = tracker.readAt[reader]
            return (
              <tr key={reader}>
                <td>{readerLabel(state, reader)}</td>
                <td className="status-projects__when">{read === undefined ? t.statusPage.notRead : formatAgo(read, now)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

/** A project by its label; a task feed by its key and its project's label. */
function readerLabel(state: EvenKeelState, reader: string): string {
  if (state.projects.includes(reader)) return state.projectLabels[reader] ?? reader
  for (const [project, feeds] of Object.entries(state.config.feeds)) {
    const feed = feeds.find((each) => each.id === reader)
    if (feed !== undefined) return t.statusPage.feedOf(feed.key, state.projectLabels[project] ?? project)
  }
  return reader
}
