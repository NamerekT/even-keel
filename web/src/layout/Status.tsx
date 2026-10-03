import { Link } from 'react-router'
import type { HulyTask } from '../../../src/huly/model.js'
import type { SessionView } from '../../../src/state.js'
import { useLive } from '../live/context.js'
import { taskProject, waitingSessions } from '../state.js'
import { systemChecks, worstLevel, type Level } from './system.js'
import { usePopover } from './usePopover.js'

const LEVEL_LABELS: Record<Level, string> = {
  ok: 'всё работает',
  warn: 'есть предупреждения',
  error: 'есть сбои',
  off: 'нет данных',
}

export function Waiting({ sessions, tasks }: { sessions: SessionView[]; tasks: HulyTask[] }) {
  const waiting = waitingSessions(sessions, tasks)
  const first = waiting[0]
  if (first === undefined) return null

  return (
    <Link
      to={`/p/${taskProject(first.task)}#${first.task}`}
      className="waiting"
      title={`Ждут ответа: ${waiting.map((view) => view.task).join(', ')}`}
    >
      <span className="waiting__count">{waiting.length}</span>
      <span className="waiting__label">
        ждут<span className="waiting__tail"> ответа</span>
      </span>
    </Link>
  )
}

export function SystemMenu({ now }: { now: Date }) {
  const { state, link, retryNow } = useLive()
  const { open, setOpen, rootRef } = usePopover()
  const checks = systemChecks(
    { link, huly: state?.huly ?? null, usage: state?.usage ?? null, configError: state?.configError ?? null },
    now,
  )
  const level = worstLevel(checks)
  const label = `Состояние: ${LEVEL_LABELS[level]}`

  return (
    <div className="queue-menu" ref={rootRef}>
      <button
        type="button"
        className={`system-toggle system-toggle--${level}`}
        aria-expanded={open}
        aria-controls="system-panel"
        aria-label={label}
        title={label}
        onClick={() => setOpen(!open)}
      >
        <GearIcon />
        <span className="system-toggle__dot" aria-hidden="true" />
      </button>
      {open && (
        <div id="system-panel" className="queue system" role="dialog" aria-label="Состояние системы">
          <h2 className="queue__heading">Состояние</h2>
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
          {link === 'stale' && (
            <button type="button" className="button system__retry" onClick={retryNow}>
              Повторить
            </button>
          )}
        </div>
      )}
    </div>
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
