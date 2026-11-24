import type { ReactNode } from 'react'
import { t } from '../i18n/index.js'
import { CloseIcon } from '../ui/icons.js'
import { PageHead } from '../ui/blocks.js'

interface FrameProps {
  title: ReactNode
  actions?: ReactNode
  /** Set — the header's drawer over the page (BTN-1587); unset — the page `/accounts`. */
  onClose?: () => void
  children: ReactNode
}

/** The frame of the accounts' content: the page with its head, or the same content as a side drawer with a close button. */
export function AccountsFrame({ title, actions, onClose, children }: FrameProps) {
  if (onClose === undefined) {
    return <div className="page accounts-page"><PageHead title={title} actions={actions} />{children}</div>
  }
  return <aside id="account-panel" className="drawer account-drawer" role="dialog" aria-label={t.account.title}>
    <div className="drawer__head">
      <h2 className="drawer__title">{title}</h2>
      {actions !== undefined && <div className="account-drawer__actions">{actions}</div>}
      <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}><CloseIcon /></button>
    </div>
    {children}
  </aside>
}
