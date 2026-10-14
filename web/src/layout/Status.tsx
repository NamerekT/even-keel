import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import type { Task } from '../../../src/tracker/model.js'
import type { SessionView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { projectPath, taskProject, waitingSessions } from '../state.js'
import { systemChecks, worstLevel, type Check } from './system.js'
import { usePopover } from './usePopover.js'

export function Waiting({ sessions, tasks }: { sessions: SessionView[]; tasks: Task[] }) {
  const { state } = useLive()
  const waiting = waitingSessions(sessions, tasks)
  const first = waiting[0]
  if (first === undefined) return null

  return (
    <Link
      to={`${projectPath(state, taskProject(first.task))}#${first.task}`}
      className="waiting"
      title={t.status.waitingTitle(waiting.map((view) => view.task).join(', '))}
    >
      <span className="waiting__count">{waiting.length}</span>
      <span className="waiting__label">
        {t.status.waiting}
        <span className="waiting__tail">{t.status.waitingTail}</span>
      </span>
    </Link>
  )
}

function useChecks(now: Date) {
  const { state, link, retryNow } = useLive()
  const checks = systemChecks(
    { link, trackers: state?.trackers ?? null, usage: state?.usage ?? null, configError: state?.configError ?? null },
    now,
  )
  return { checks, level: worstLevel(checks), stale: link === 'stale', retryNow }
}

/** The narrow screen's sheet ends with the gear's items as rows; the status unfolds its checks in place. */
export function GearRows({ now }: { now: Date }) {
  const { checks, level, stale, retryNow } = useChecks(now)
  const [open, setOpen] = useState(false)

  return (
    <nav className="sheet__rows" aria-label={t.header.settings}>
      <button type="button" className={`gear__item gear__item--${level}`} aria-expanded={open} aria-controls="system-panel" onClick={() => setOpen(!open)}>
        <span>{t.status.heading}</span>
        <span className="gear__level">
          <span className="system__dot" aria-hidden="true" />
          {t.status.levels[level]}
          <span className={open ? 'sheet__chevron sheet__chevron--open' : 'sheet__chevron'} aria-hidden="true">
            ›
          </span>
        </span>
      </button>
      {open && (
        <div id="system-panel" className="system sheet__checks" role="region" aria-label={t.status.panel}>
          <CheckList checks={checks} stale={stale} retryNow={retryNow} />
        </div>
      )}
      <NavLink to="/settings" className="gear__item">
        {t.header.settings}
      </NavLink>
      <NavLink to="/tools" className="gear__item">
        {t.header.tools}
      </NavLink>
    </nav>
  )
}

/**
 * The gear at the end of the wide header: a menu to the settings, the status checks and the tools.
 * Its dot shows only when a check warns or fails.
 */
export function GearMenu({ now }: { now: Date }) {
  const { checks, level, stale, retryNow } = useChecks(now)
  const { open, setOpen, rootRef } = usePopover()
  const [view, setView] = useState<'menu' | 'status'>('menu')
  const { pathname } = useLocation()
  const here = pathname.startsWith('/settings') || pathname.startsWith('/tools')
  const label = t.header.gear(t.status.levels[level])
  const toggle = () => {
    setView('menu')
    setOpen(!open)
  }

  return (
    <div className="queue-menu" ref={rootRef}>
      <button
        type="button"
        className={`system-toggle gear-toggle gear-toggle--${level}${here ? ' active' : ''}`}
        aria-expanded={open}
        aria-controls="gear-panel"
        aria-label={label}
        title={label}
        onClick={toggle}
      >
        <GearIcon />
        <span className="system-toggle__dot" aria-hidden="true" />
      </button>
      {open && view === 'menu' && (
        <nav id="gear-panel" className="queue gear" aria-label={t.header.settings}>
          <NavLink to="/settings" className="gear__item">
            {t.header.settings}
          </NavLink>
          <button type="button" className={`gear__item gear__item--${level}`} onClick={() => setView('status')}>
            <span>{t.status.heading}</span>
            <span className="gear__level">
              <span className="system__dot" aria-hidden="true" />
              {t.status.levels[level]}
            </span>
          </button>
          <NavLink to="/tools" className="gear__item">
            {t.header.tools}
          </NavLink>
        </nav>
      )}
      {open && view === 'status' && (
        <div id="gear-panel" className="queue system" role="dialog" aria-label={t.status.panel}>
          <div className="gear__head">
            <button type="button" className="gear__back" aria-label={t.header.back} title={t.header.back} onClick={() => setView('menu')}>
              ‹
            </button>
            <h2 className="queue__heading">{t.status.heading}</h2>
          </div>
          <CheckList checks={checks} stale={stale} retryNow={retryNow} />
        </div>
      )}
    </div>
  )
}

function CheckList({ checks, stale, retryNow }: { checks: Check[]; stale: boolean; retryNow: () => void }) {
  return (
    <>
      <ul className="system__list">
        {checks.map((check) => (
          <li key={check.name} className={`system__row system__row--${check.level}`}>
            <span className="system__dot" aria-hidden="true" />
            <span className="system__name">{check.name}</span>
            <span className="system__text">{check.text}</span>
            {check.details.map((detail) => (
              <span key={detail} className="system__detail">
                {detail}
              </span>
            ))}
          </li>
        ))}
      </ul>
      {stale && (
        <button type="button" className="button system__retry" onClick={retryNow}>
          {t.common.retry}
        </button>
      )}
    </>
  )
}

function GearIcon() {
  return (
    <svg className="system-toggle__gear" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
