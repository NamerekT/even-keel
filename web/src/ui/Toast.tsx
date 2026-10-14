import type { ReactNode } from 'react'
import { t } from '../i18n/index.js'
import './toast.css'

export interface ToastAction {
  label: string
  onClick: () => void
}

/** The corner of the page toasts stack in; it stays in the page empty, so a screen reader hears a toast that appears. */
export function ToastStack({ children }: { children: ReactNode }) {
  return (
    <section className="toasts" aria-label={t.toast.region} aria-live="polite">
      {children}
    </section>
  )
}

/**
 * A notification in the manner of Windows: who it is from, a title and a line under it, buttons below. With `href`
 * the body is a link that opens in a new tab.
 */
export function Toast({ source, icon, title, body, href, actions }: { source: string; icon?: string; title: string; body: string; href?: string; actions: ToastAction[] }) {
  const content = (
    <>
      <span className="toast__source">
        {icon !== undefined && <img className="toast__icon" src={icon} alt="" width={16} height={16} />}
        {source}
      </span>
      <strong className="toast__title">{title}</strong>
      <span className="toast__body">{body}</span>
    </>
  )
  return (
    <div className="toast" role="status">
      {href === undefined ? (
        <div className="toast__main">{content}</div>
      ) : (
        <a className="toast__main toast__main--link" href={href} target="_blank" rel="noreferrer">
          {content}
        </a>
      )}
      {actions.length > 0 && (
        <div className="toast__actions">
          {actions.map((action) => (
            <button key={action.label} type="button" className="button button--small toast__action" onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
