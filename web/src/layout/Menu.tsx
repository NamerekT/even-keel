import { NavLink } from 'react-router'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { accountBadge } from '../state.js'
import { AccountMenu } from './Account.js'
import { Limits } from './Limits.js'
import { QueueMenu } from './Queue.js'
import { SystemMenu } from './Status.js'
import { systemChecks, worstLevel, type Level } from './system.js'
import { usePopover } from './usePopover.js'

export function MobileMenu({ now }: { now: Date }) {
  const { state, link } = useLive()
  const { open, setOpen, rootRef } = usePopover()
  const system = worstLevel(
    systemChecks({ link, trackers: state?.trackers ?? null, usage: state?.usage ?? null, configError: state?.configError ?? null }, now),
  )
  const level = state === null ? system : withAccount(system, accountBadge(state.account).kind)

  return (
    <div className="queue-menu" ref={rootRef}>
      <button
        type="button"
        className={`system-toggle system-toggle--${level}`}
        aria-expanded={open}
        aria-controls="menu-sheet"
        aria-label={t.header.menu}
        title={t.header.menu}
        onClick={() => setOpen(!open)}
      >
        <BurgerIcon />
        <span className="system-toggle__dot" aria-hidden="true" />
      </button>
      {open && (
        <div id="menu-sheet" className="menu-sheet">
          <nav className="menu-sheet__links" aria-label={t.header.nav}>
            <NavLink to="/stats" className="header__link">
              {t.header.stats}
            </NavLink>
            <NavLink to="/tools" className="header__link">
              {t.header.tools}
            </NavLink>
            <NavLink to="/settings" className="header__link">
              {t.header.settings}
            </NavLink>
          </nav>
          <div className="menu-sheet__chips">
            {state !== null && <QueueMenu state={state} />}
            {state !== null && <AccountMenu account={state.account} />}
            <SystemMenu now={now} />
          </div>
          {state !== null && <Limits limits={state.limits} now={now} />}
        </div>
      )}
    </div>
  )
}

function withAccount(system: Level, account: string): Level {
  if (account === 'out') return 'error'
  if (account === 'login' && system !== 'error') return 'warn'
  return system
}

function BurgerIcon() {
  return (
    <svg className="system-toggle__gear" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}
