import { Link, useMatch } from 'react-router'
import type { Link as LinkState } from '../live/connection.js'
import { useLive } from '../live/context.js'

const LINK_LABELS: Record<LinkState, string> = {
  connecting: 'Подключение',
  live: 'На связи',
  stale: 'Нет связи',
}

export function Header() {
  const { link } = useLive()
  const project = useMatch('/p/:key')?.params.key

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
          <span className={`link-state link-state--${link}`} role="status">
            <span className="link-state__dot" aria-hidden="true" />
            {LINK_LABELS[link]}
          </span>
        </div>
      </div>
    </header>
  )
}
