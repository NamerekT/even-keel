import { Link, NavLink, useLocation } from 'react-router'
import type { Task } from '../../../src/tracker/model.js'
import type { SessionView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { projectPath, taskProject, waitingSessions } from '../state.js'
import { completionTasks } from '../completion.js'
import { systemChecks, systemInput, worstLevel, type Level } from './system.js'
import { VersionRow } from './Updates.js'
import { usePopover } from './usePopover.js'

export function Waiting({ sessions, tasks }: { sessions: SessionView[]; tasks: Task[] }) {
  const { state } = useLive()
  const waiting = waitingSessions(sessions, tasks, completionTasks(state))
  const first = waiting[0]
  if (first === undefined) return null

  return (
    <Link
      to={`${projectPath(taskProject(state, first.task))}#${first.task}`}
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

export function useChecks(now: Date) {
  const { state, link, retryNow } = useLive()
  const checks = systemChecks(systemInput(state, link), now)
  return { checks, level: worstLevel(checks), stale: link === 'stale', retryNow }
}

/** The gear's status row: the worst level of the checks, a link to `/status` (BTN-66). */
function StatusRow({ level }: { level: Level }) {
  return (
    <NavLink to="/status" className={`gear__item gear__item--${level}`} title={t.statusPage.open}>
      <span>{t.status.heading}</span>
      <span className="gear__level">
        <span className="system__dot" aria-hidden="true" />
        {t.status.levels[level]}
      </span>
    </NavLink>
  )
}

/** The narrow screen's sheet ends with the gear's items as rows. */
export function GearRows({ now }: { now: Date }) {
  const { level } = useChecks(now)

  return (
    <nav className="sheet__rows" aria-label={t.header.settings}>
      <StatusRow level={level} />
      <NavLink to="/settings" className="gear__item">
        {t.header.settings}
      </NavLink>
      <NavLink to="/tools" className="gear__item">
        {t.header.tools}
      </NavLink>
      <VersionRow />
    </nav>
  )
}

/**
 * The gear at the end of the wide header: a menu to the settings, the status page and the tools.
 * Its dot shows only when a check warns or fails.
 */
export function GearMenu({ now }: { now: Date }) {
  const { level } = useChecks(now)
  const { open, setOpen, rootRef } = usePopover()
  const { pathname } = useLocation()
  const here = ['/settings', '/tools', '/status'].some((path) => pathname.startsWith(path))
  const label = t.header.gear(t.status.levels[level])

  return (
    <div className="queue-menu" ref={rootRef}>
      <button
        type="button"
        className={`system-toggle gear-toggle gear-toggle--${level}${here ? ' active' : ''}`}
        aria-expanded={open}
        aria-controls="gear-panel"
        aria-label={label}
        title={label}
        onClick={() => setOpen(!open)}
      >
        <GearIcon />
        <span className="system-toggle__dot" aria-hidden="true" />
      </button>
      {open && (
        <nav id="gear-panel" className="queue gear" aria-label={t.header.settings}>
          <NavLink to="/settings" className="gear__item">
            {t.header.settings}
          </NavLink>
          <StatusRow level={level} />
          <NavLink to="/tools" className="gear__item">
            {t.header.tools}
          </NavLink>
          <VersionRow />
        </nav>
      )}
    </div>
  )
}

export function GearIcon() {
  return (
    <svg className="system-toggle__gear" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
