import { NavLink } from 'react-router'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { LOG_PATH, useUnread } from './eventLog.js'

/** "Log" in the header and the menu, with the count of warnings and errors not seen there yet, red when one is an error. */
export function LogLink({ className }: { className: string }) {
  const { state } = useLive()
  const { count, error } = useUnread(state?.eventLog)
  return (
    <NavLink to={LOG_PATH} className={className}>
      {t.events.log}
      {count > 0 && (
        <span className={`log-count${error ? ' log-count--error' : ''}`} aria-label={t.events.unread(count)}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </NavLink>
  )
}
