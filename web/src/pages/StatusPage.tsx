import { useEffect, useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router'
import { BUILTIN } from '../../../src/builtin/model.js'
import type { EvenKeelState } from '../../../src/state.js'
import type { TrackerView } from '../../../src/tracker/health.js'
import { say, t } from '../i18n/index.js'
import { useMachineFilter } from '../layout/MachineFilter.js'
import { CardLine } from '../layout/MachinePanel.js'
import { useChecks } from '../layout/Status.js'
import { machinePath } from '../machineColor.js'
import { machineState } from '../machineView.js'
import type { Check } from '../layout/system.js'
import { useNow } from '../layout/useNow.js'
import { useCommand } from '../live/useCommand.js'
import { Band, Card, CardHead, EmptyState, PageHead, TileGrid } from '../ui/blocks.js'
import { TrackerIcon } from '../ui/icons.js'
import { useProjectLabel } from '../ui/ProjectLabel.js'
import { FixButton, useFix } from './FixButtons.js'
import { HelpTip } from './settingsParts.js'
import { openTasks, problemsOf, refreshedProjects, staleReaders } from './status.js'
import { LinkState, Reader, readerName } from './statusLink.js'
import { trackerDownText } from './trackerDown.js'
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
  const found = checks.filter((check) => check.tracker !== undefined)
  // The built-in tracker is always there, first: a newcomer without another tracker sees it, not an empty list (BTN-769).
  const own = found.find((check) => check.tracker!.kind === BUILTIN)
  const connections = [own ?? idleBuiltin(), ...found.filter((check) => check !== own)]

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
        {connections.map((check) => (
          <Connection key={check.key} state={state} tracker={check.tracker!} now={now} className={lit(check.key)} />
        ))}
      </section>
      <StatusMachines state={state} now={now} />
    </div>
  )
}

/** The hub's machines at the bottom (BTN-1279): each with its lamp and line as the machines panel judges them; none with one machine. */
function StatusMachines({ state, now }: { state: EvenKeelState; now: Date }) {
  const { cards } = useMachineFilter()
  if (cards.length < 2) return null
  return (
    <section className="status-connections" aria-labelledby="status-machines">
      <h2 id="status-machines" className="status-connections__title">
        {t.machinePanel.view.statusTitle}
      </h2>
      <TileGrid className="status-checks">
        {cards.map((card) => {
          const view = machineState(state, cards, card)
          const id = `${anchorOf(`machine-${card.id}`)}-title`
          return (
            <Card key={card.id} id={anchorOf(`machine-${card.id}`)} aria-labelledby={id} className="status-machine" style={{ '--machine': card.color } as CSSProperties}>
              <CardHead title={<Link to={machinePath(card.id)} className="status-machine__name">{card.name}</Link>} id={id}>
                {card.own && <span className="tag">{t.pool.own}</span>}
              </CardHead>
              <p className="status-check__state">
                <span className={`machine-lamp machine-lamp--${view.lamp}`} role="img" aria-label={t.machinePanel.lamps[view.lamp]} />
                <CardLine view={view} now={now} />
              </p>
              {/* A machine that cannot work: its fixes are on its page. */}
              {(view.lamp === 'blocked' || view.lamp === 'offline') && (
                <div className="status-machine__actions">
                  <Link to={machinePath(card.id)} className="button button--small">
                    {t.machinePanel.view.machinePage}
                  </Link>
                </div>
              )}
            </Card>
          )
        })}
      </TileGrid>
    </section>
  )
}

/** The built-in tracker no project runs on: the service has no connection for it, the database is its own. */
function idleBuiltin(): Check {
  const name = `none:${BUILTIN}`
  const tracker: TrackerView = { name, kind: BUILTIN, title: t.system.builtin, projects: [], ready: true, health: { state: 'live', lastOkAt: null, error: null }, readAt: {} }
  return { key: name, name: t.system.builtin, level: 'ok', text: t.statusPage.builtinReady, details: [], tracker }
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
        <strong>{t.statusPage.problems(problems.length)}:</strong>
        {/* A profile's name says no tracker since BTN-1382: its icon does. */}
        <span className="status-summary__name">
          {first.tracker !== undefined && <TrackerIcon kind={first.tracker.kind} />}
          {first.name} — {first.text}
        </span>
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

/** The button that fixes a check: reconnecting, the Huly client's install, the profile of a connection, or the place of the settings. */
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
  if (fix.kind === 'hulyClient') return <HulyInstallButton busy={check.level === 'warn'} />
  if (check.tracker !== undefined) return <ProfileButton />
  return <FixButton project={null} fix={fix.fix} className="button button--small" />
}

/** Installs the Huly client once more; off while an install runs. */
function HulyInstallButton({ busy }: { busy: boolean }) {
  const { send, sending } = useCommand()
  return (
    <button type="button" className="button button--small" disabled={busy || sending} onClick={() => void send('huly/install', {})}>
      {t.common.retry}
    </button>
  )
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
  const readers = tracker.projects.flatMap((reader) => readerName(state, reader, label) ?? [])
  const level = health.state === 'live' ? 'ok' : health.state === 'down' ? 'error' : health.state === 'connecting' ? 'warn' : 'off'
  const id = `${anchorOf(tracker.name)}-title`
  const check = () => void Promise.all(refreshed.map((project) => send('chain/refresh', { project })))
  // The built-in tracker is the state database: no profile to open, nothing remote to check.
  const own = tracker.kind === BUILTIN

  return (
    <Card id={anchorOf(tracker.name)} aria-labelledby={id} className={`status-connection system__row--${level}${className}`}>
      <CardHead
        id={id}
        title={
          <span className="status-connection__name">
            <TrackerIcon kind={tracker.kind} />
            {own ? t.system.builtin : tracker.title}
          </span>
        }
        actions={<LinkState tracker={tracker} now={now} open={own ? openTasks(state, tracker.projects) : null} />}
      />
      {health.state === 'down' && health.error !== null && (
        <p className="status-connection__error">
          {own ? t.system.lost : trackerDownText(health)}
          {/* A notice is the error itself, said in the page's language: no tip repeats it. */}
          {health.notice === undefined && <HelpTip text={health.error} />}
        </p>
      )}
      {readers.length === 0 ? (
        <EmptyState action={<AddProject />}>{own ? t.statusPage.builtinNoProjects : t.statusPage.noProjects}</EmptyState>
      ) : (
        <div className="status-connection__foot">
          <ul className="status-readers" aria-label={t.statusPage.readers}>
            {readers.map(({ reader, name, about }) => (
              <Reader key={reader} name={name} about={about} stale={stale.has(reader)} read={stale.get(reader) ?? null} now={now} />
            ))}
          </ul>
          {!own && <div className="status-connection__actions">
            {failure !== null && <span className="status-connection__failure">{say(failure)}</span>}
            {refreshed.length > 0 && health.state !== 'off' && (
              <button type="button" className="button button--small" title={t.statusPage.checkHint} disabled={sending} onClick={check}>
                {t.statusPage.check}
              </button>
            )}
            <ProfileButton primary={health.state === 'down'} />
          </div>}
        </div>
      )}
    </Card>
  )
}
