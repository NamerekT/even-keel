import { NavLink } from 'react-router'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { accountBadge } from '../state.js'
import { AccountSheet } from './AccountBlock.js'
import { QueueMenu } from './Queue.js'
import { GearRows, Waiting } from './Status.js'
import { systemChecks, systemInput, worstLevel, type Level } from './system.js'
import { usePopover } from './usePopover.js'

/** The narrow screen's burger: one column of the wide header's blocks — stats, the work, the account with its limits, the gear's items. */
export function MobileMenu({ now }: { now: Date }) {
  const { state, link } = useLive()
  const { open, setOpen, rootRef } = usePopover()
  const system = worstLevel(systemChecks(systemInput(state, link), now))
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
          <nav className="sheet__rows" aria-label={t.header.nav}>
            <NavLink to="/stats" className="gear__item">
              {t.header.stats}
            </NavLink>
          </nav>
          {state !== null && (
            <div className="sheet__work">
              <QueueMenu state={state} />
              <Waiting sessions={state.sessions} tasks={state.tasks} />
            </div>
          )}
          {state !== null && <AccountSheet account={state.account} limits={state.limits} now={now} />}
          <GearRows now={now} />
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

export function BurgerIcon() {
  return (
    <svg className="system-toggle__gear" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}
