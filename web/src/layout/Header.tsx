import { Link, NavLink, useMatch } from 'react-router'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { AccountMenu } from './Account.js'
import { Limits } from './Limits.js'
import { QueueMenu } from './Queue.js'
import { SystemMenu, Waiting } from './Status.js'
import { useTabBadge } from './tabBadge.js'
import { useNow } from './useNow.js'

const CLOCK_MS = 5_000

export function Header() {
  const { state } = useLive()
  const project = useMatch('/p/:key')?.params.key
  const now = useNow(CLOCK_MS)
  useTabBadge(now)

  return (
    <header className="header">
      <div className="header__inner">
        <nav className="header__nav" aria-label={t.header.nav}>
          <Link to="/" className="header__brand">
            <img className="header__logo" src="/favicon.svg" alt="" width={22} height={22} />
            Even Keel
          </Link>
          {project !== undefined && (
            <>
              <span className="header__sep" aria-hidden="true">
                /
              </span>
              <span className="header__crumb">{project}</span>
            </>
          )}
          <NavLink to="/stats" className="header__link">
            {t.header.stats}
          </NavLink>
        </nav>
        <div className="header__aside">
          {state !== null && <QueueMenu state={state} />}
          {state !== null && <AccountMenu account={state.account} />}
          {state !== null && <Waiting sessions={state.sessions} tasks={state.tasks} />}
          <SystemMenu now={now} />
        </div>
        {state !== null && (
          <div className="header__limits">
            <Limits limits={state.limits} now={now} />
          </div>
        )}
      </div>
    </header>
  )
}
