import { useRef } from 'react'
import { t } from '../i18n/index.js'
import { useNarrow } from '../layout/useNarrow.js'
import { MenuIcon } from '../ui/icons.js'
import { UnsavedDot } from './settingsParts.js'

interface Props<T extends string> {
  groups: readonly { id: T; title: string }[]
  open: T
  dirty: (id: T) => boolean
  onOpen: (id: T) => void
}

/** The groups of the settings page: a column at the left, and on a narrow screen a drawer behind a button. */
export function SettingsNav<T extends string>({ groups, open, dirty, onOpen }: Props<T>) {
  const narrow = useNarrow()
  const drawer = useRef<HTMLDialogElement>(null)
  const current = groups.find((group) => group.id === open)!

  const list = (
    <ul className="settings-nav__list">
      {groups.map(({ id, title }) => (
        <li key={id}>
          <button
            type="button"
            className="settings-nav__item"
            aria-current={id === open ? 'true' : undefined}
            onClick={() => {
              onOpen(id)
              drawer.current?.close()
            }}
          >
            <span className="settings-nav__title">{title}</span>
            {dirty(id) && <UnsavedDot />}
          </button>
        </li>
      ))}
    </ul>
  )

  if (!narrow) {
    return (
      <nav className="settings-nav" aria-label={t.settings.groupsLabel}>
        {list}
      </nav>
    )
  }
  return (
    <>
      <button type="button" className="settings-nav__toggle" aria-haspopup="dialog" onClick={() => drawer.current?.showModal()}>
        <MenuIcon />
        <span className="settings-nav__title">{current.title}</span>
        {groups.some(({ id }) => dirty(id)) && <UnsavedDot />}
      </button>
      <dialog
        ref={drawer}
        className="settings-drawer"
        aria-label={t.settings.groupsLabel}
        onClick={(event) => event.target === drawer.current && drawer.current.close()}
      >
        <nav className="settings-drawer__body" aria-label={t.settings.groupsLabel}>
          <div className="settings-drawer__head">
            <span className="settings-drawer__heading">{t.settings.groupsLabel}</span>
            <button type="button" className="panel__close" aria-label={t.session.closePanel} onClick={() => drawer.current?.close()}>
              ×
            </button>
          </div>
          {list}
        </nav>
      </dialog>
    </>
  )
}
