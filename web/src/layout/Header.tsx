import { Link, NavLink, useMatch } from 'react-router'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { SETUP } from '../pages/setupSteps.js'
import { projectOfPath } from '../state.js'
import { ProjectLabel } from '../ui/ProjectLabel.js'
import { AccountBlock } from './AccountBlock.js'
import { Limits } from './Limits.js'
import { MobileMenu } from './Menu.js'
import { QueueMenu } from './Queue.js'
import { GearMenu, Waiting } from './Status.js'
import { useNarrow } from './useNarrow.js'
import { useTabBadge } from './tabBadge.js'
import { useNow } from './useNow.js'
import './header.css'

const CLOCK_MS = 5_000

export function Header() {
  const { state } = useLive()
  const param = useMatch('/p/:id')?.params.id
  const project = param === undefined || state === null ? param : projectOfPath(state, param).project
  const now = useNow(CLOCK_MS)
  const narrow = useNarrow()
  useTabBadge(now)
  // The first run's setup is noise-free (BTN-346): no chain, account or limits yet to look at, the logo and the gear stay.
  const setup = useMatch(SETUP) !== null
  const live = setup ? null : state

  return (
    <header className="header">
      <div className="header__inner">
        <nav className="header__nav" aria-label={t.header.nav}>
          <Link to="/" className="header__brand">
            <img className="header__logo" src="/favicon.svg" alt="" width={22} height={22} />
            <span className="header__name">Even Keel</span>
          </Link>
          {project !== undefined && (
            <>
              <span className="header__sep" aria-hidden="true">
                /
              </span>
              <span className="header__crumb">
                <ProjectLabel project={project} keyClass="header__crumb-key" />
              </span>
            </>
          )}
          {!narrow && !setup && (
            <>
              <span className="header__divider" aria-hidden="true" />
              <NavLink to="/stats" className="header__link">
                {t.header.stats}
              </NavLink>
            </>
          )}
        </nav>
        {narrow ? (
          <div className="header__aside">
            {live !== null && <Waiting sessions={live.sessions} tasks={live.tasks} />}
            <MobileMenu now={now} />
          </div>
        ) : (
          <div className="header__aside">
            {live !== null && (
              <div className="work-anchor">
                <div className="hblock work-block">
                  <QueueMenu state={live} />
                  <Waiting sessions={live.sessions} tasks={live.tasks} />
                </div>
              </div>
            )}
            {live !== null && <AccountBlock account={live.account} limits={live.limits} now={now} />}
            <GearMenu now={now} />
          </div>
        )}
        {live !== null && narrow && (
          <div className="header__limits">
            <Limits limits={live.limits} now={now} />
          </div>
        )}
      </div>
    </header>
  )
}
