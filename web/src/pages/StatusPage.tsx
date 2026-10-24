import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import type { TrackerView } from '../../../src/tracker/health.js'
import { formatAgo } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useChecks } from '../layout/Status.js'
import type { Check } from '../layout/system.js'
import { useNow } from '../layout/useNow.js'
import { useCommand } from '../live/useCommand.js'
import { Band, Card, CardHead, EmptyState, PageHead, TileGrid } from '../ui/blocks.js'
import { TrackerIcon } from '../ui/icons.js'
import { ProjectLabel, useProjectLabel } from '../ui/ProjectLabel.js'
import { Tipped } from '../ui/Tipped.js'
import { FixButton, useFix } from './FixButtons.js'
import { HelpTip } from './settingsParts.js'
import { problemsOf, refreshedProjects, staleReaders, trackerProblem } from './status.js'
import './settings.css'
import './status.css'

const CLOCK_MS = 5_000
const ADD_PROJECT = '/projects/add'

const anchorOf = (key: string) => `status-${key}`

/**
 * `/status` (BTN-66, BTN-357): everything on one screen — the summary band, a tile per check, a card per tracker
 * connection. `?item=<key>` scrolls to that tile or card and lights it once.
 */
export function StatusPage({ state }: { state: EvenKeelState }) {
  const now = useNow(CLOCK_MS)
  const { checks, retryNow } = useChecks(now)
  const [params] = useSearchParams()
  const [focus] = useState(() => params.get('item'))
  const plain = checks.filter((check) => check.tracker === undefined)
  const connections = checks.filter((check) => check.tracker !== undefined)

  useEffect(() => {
    if (focus !== null) document.getElementById(anchorOf(focus))?.scrollIntoView({ block: 'center' })
  }, [focus])

  const lit = (key: string) => (key === focus ? ' status-page__lit' : '')

  return (
    <div className="page status-page">
      <PageHead title={t.statusPage.title} help={<HelpTip text={t.statusPage.hint} />} />
      <Summary checks={checks} retry={retryNow} />
      <TileGrid className="status-checks">
        {plain.map((check) => (
          <CheckTile key={check.key} check={check} retry={retryNow} className={lit(check.key)} />
        ))}
      </TileGrid>
      <section className="status-connections" aria-labelledby="status-connections">
        <h2 id="status-connections" className="status-connections__title">
          {t.statusPage.connections}
        </h2>
        {connections.length === 0 ? (
          <Card>
            <EmptyState action={<AddProject />}>{t.statusPage.noConnections}</EmptyState>
          </Card>
        ) : (
          connections.map((check) => <Connection key={check.key} state={state} tracker={check.tracker!} now={now} className={lit(check.key)} />)
        )}
      </section>
    </div>
  )
}

/** "All is well", or the count of problems with the first of them and what fixes it. */
function Summary({ checks, retry }: { checks: Check[]; retry: () => void }) {
  const problems = problemsOf(checks)
  const first = problems[0]
  if (first === undefined) {
    return (
      <Band tone="note" className="status-summary system__row--ok">
        <span className="status-summary__line">
          <span className="system__dot" aria-hidden="true" />
          {t.statusPage.allFine}
        </span>
      </Band>
    )
  }
  const action = <CheckAction check={first} retry={retry} />
  return (
    <Band tone={first.level === 'error' ? 'error' : 'warn'} action={action} className="status-summary">
      <span className="status-summary__line">
        <strong>{t.statusPage.problems(problems.length)}:</strong> {first.name} — {first.text}
      </span>
    </Band>
  )
}

function CheckTile({ check, retry, className }: { check: Check; retry: () => void; className: string }) {
  const id = `${anchorOf(check.key)}-title`
  return (
    <Card id={anchorOf(check.key)} aria-labelledby={id} className={`status-check system__row--${check.level}${className}`}>
      <CardHead title={check.name} id={id}>
        {check.details.length > 0 && <HelpTip text={check.details.join(' ')} />}
      </CardHead>
      <p className="status-check__state">
        <span className="system__dot" aria-hidden="true" />
        {check.text}
      </p>
      {check.note !== undefined && <p className="status-check__note">{check.note}</p>}
      {check.fix !== undefined && (
        <div className="status-check__action">
          <CheckAction check={check} retry={retry} />
        </div>
      )}
    </Card>
  )
}

/** The button that fixes a check: reconnecting, the profile of a connection, or the place of the settings. */
function CheckAction({ check, retry }: { check: Check; retry: () => void }) {
  const { fix } = check
  if (fix === undefined) return null
  if (fix.kind === 'retry') {
    return (
      <button type="button" className="button button--small" onClick={retry}>
        {t.common.retry}
      </button>
    )
  }
  if (check.tracker !== undefined) return <ProfileButton />
  return <FixButton project={null} fix={fix.fix} className="button button--small" />
}

function ProfileButton({ primary = false }: { primary?: boolean }) {
  const go = useFix()
  return (
    <button type="button" className={`button button--small${primary ? ' button--primary' : ''}`} onClick={() => go({ to: 'shared', tab: 'trackers' }, null)}>
      {t.statusPage.openProfile}
    </button>
  )
}

function AddProject() {
  return (
    <Link to={ADD_PROJECT} className="button button--small">
      {t.statusPage.addProject}
    </Link>
  )
}

function Connection({ state, tracker, now, className }: { state: EvenKeelState; tracker: TrackerView; now: Date; className: string }) {
  const { health } = tracker
  const { send, sending, failure } = useCommand()
  const stale = staleReaders(tracker, now)
  const refreshed = refreshedProjects(state, tracker)
  const label = useProjectLabel()
  const readers = tracker.projects.flatMap((reader) => {
    const name = readerName(state, reader, label)
    return name === null ? [] : [{ reader, name }]
  })
  const level = health.state === 'live' ? 'ok' : health.state === 'down' ? 'error' : health.state === 'connecting' ? 'warn' : 'off'
  const id = `${anchorOf(tracker.name)}-title`
  const check = () => void Promise.all(refreshed.map((project) => send('chain/refresh', { project })))

  return (
    <Card id={anchorOf(tracker.name)} aria-labelledby={id} className={`status-connection system__row--${level}${className}`}>
      <CardHead
        id={id}
        title={
          <span className="status-connection__name">
            <TrackerIcon kind={tracker.kind} />
            {tracker.title}
          </span>
        }
        actions={<LinkState tracker={tracker} now={now} />}
      />
      {health.state === 'down' && health.error !== null && (
        <p className="status-connection__error">
          {t.statusPage.trackerProblem[trackerProblem(health.error)]}
          <HelpTip text={health.error} />
        </p>
      )}
      {readers.length === 0 ? (
        <EmptyState action={<AddProject />}>{t.statusPage.noProjects}</EmptyState>
      ) : (
        <div className="status-connection__foot">
          <ul className="status-readers" aria-label={t.statusPage.readers}>
            {readers.map(({ reader, name }) => (
              <Reader key={reader} name={name} stale={stale.has(reader)} read={stale.get(reader) ?? null} now={now} />
            ))}
          </ul>
          <div className="status-connection__actions">
            {failure !== null && <span className="status-connection__failure">{say(failure)}</span>}
            {refreshed.length > 0 && health.state !== 'off' && (
              <button type="button" className="button button--small" title={t.statusPage.checkHint} disabled={sending} onClick={check}>
                {t.statusPage.check}
              </button>
            )}
            <ProfileButton primary={health.state === 'down'} />
          </div>
        </div>
      )}
    </Card>
  )
}

/** The dot and word of a connection, and when it last answered. */
function LinkState({ tracker, now }: { tracker: TrackerView; now: Date }) {
  const { health } = tracker
  const ago = health.lastOkAt === null ? null : formatAgo(health.lastOkAt, now)
  const [word, tail] =
    health.state === 'live'
      ? [t.system.live, ago === null ? null : t.statusPage.polled(ago)]
      : health.state === 'down'
        ? [t.system.lost, ago === null ? t.statusPage.neverAnswered : t.statusPage.lastAnswer(ago)]
        : [health.state === 'connecting' ? t.system.connecting : t.system.off, null]
  return (
    <span className="status-connection__state">
      <span className="system__dot" aria-hidden="true" />
      {word}
      {tail !== null && <span className="status-connection__when"> · {tail}</span>}
    </span>
  )
}

/** A project or a task feed the connection reads; a stale one with when it was last read (`read`, `null` — never). */
function Reader({ name, stale, read, now }: { name: ReactNode; stale: boolean; read: string | null; now: Date }) {
  if (!stale) return <li className="tag status-reader">{name}</li>
  return (
    <li className="tag status-reader status-reader--stale">
      <Tipped tip={t.statusPage.staleHint} inline focusable>
        {name} · {read === null ? t.statusPage.notRead : t.statusPage.readAgo(formatAgo(read, now))}
      </Tipped>
    </li>
  )
}

/** A project by its label, a task feed by its key and its project's label; `null` for a reader of no known project, which is not shown by its id. */
function readerName(state: EvenKeelState, reader: string, label: (project: string) => string): ReactNode {
  if (state.projects.includes(reader)) return <ProjectLabel project={reader} nameClass="status-reader__name" />
  for (const [project, feeds] of Object.entries(state.config.feeds)) {
    const feed = feeds.find((each) => each.id === reader)
    if (feed !== undefined) return t.statusPage.feedOf(feed.key, label(project))
  }
  return null
}
