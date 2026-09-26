import { Link, useMatch } from 'react-router'
import { useLive } from '../live/context.js'
import { Limits } from './Limits.js'
import { HulyState, ServerState, Waiting } from './Status.js'
import { useNow } from './useNow.js'

const CLOCK_MS = 5_000

export function Header() {
  const { state, link } = useLive()
  const project = useMatch('/p/:key')?.params.key
  const now = useNow(CLOCK_MS)

  return (
    <header className="header">
      <div className="header__inner">
        <nav className="header__nav" aria-label="Навигация">
          <Link to="/" className="header__brand">
            Baton
          </Link>
          {project !== undefined && (
            <>
              <span className="header__sep" aria-hidden="true">
                /
              </span>
              <span className="header__crumb">{project}</span>
            </>
          )}
        </nav>
        <div className="header__aside">
          {state !== null && <Waiting sessions={state.sessions} tasks={state.tasks} />}
          {state !== null && <HulyState health={state.huly} now={now} />}
          <ServerState link={link} />
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
