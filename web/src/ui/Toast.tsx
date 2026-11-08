import { useCallback, useEffect, useRef, useState, type CSSProperties, type FocusEvent, type ReactNode } from 'react'
import { t } from '../i18n/index.js'
import { FoldList, type FoldItem } from './Fold.js'
import { ToastClock, type ToastClockView, type ToastHold } from './toastClock.js'
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
 * Toasts that slide in and out (BTN-845): a removed one stays through its exit while the rest of the stack closes
 * the gap smoothly, as `FoldList` keeps a notice. Every toast of the page goes through it or `ToastPresence`.
 */
export function ToastList({ items }: { items: FoldItem[] }) {
  return <FoldList items={items} className="toast-list" itemClassName="toast-slot" />
}

/** One toast that comes and goes: `null` or `false` takes it out through the exit. */
export function ToastPresence({ children }: { children: ReactNode }) {
  const shown = children !== null && children !== undefined && children !== false
  return <ToastList items={shown ? [{ key: 'toast', children }] : []} />
}

/** The timer of a toast that goes by itself, for `Toast`'s `timer`: its bar and what holds it. */
export interface ToastTimer {
  ms: number
  view: ToastClockView
  hold: (reason: ToastHold, held: boolean) => void
}

/** Calls `onTimeout` after `ms` of the page in sight with no pointer over the toast and no focus inside it. */
export function useToastTimer(ms: number, onTimeout: () => void): ToastTimer {
  const done = useRef(onTimeout)
  done.current = onTimeout
  const clock = useRef<ToastClock | null>(null)
  const [view, setView] = useState<ToastClockView>({ running: false, round: 0 })
  useEffect(() => {
    const own = new ToastClock(ms, () => done.current(), document.hidden, setView)
    clock.current = own
    setView(own.view())
    const onVisibility = () => own.hide(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      own.stop()
      clock.current = null
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ms])
  const hold = useCallback((reason: ToastHold, held: boolean) => clock.current?.hold(reason, held), [])
  return { ms, view, hold }
}

/**
 * A notification in the manner of Windows: who it is from, a title and a line under it, buttons below. With `href`
 * the body is a link that opens in a new tab, so the title must hold no link then. With `timer` a bar at the bottom
 * shows the time left, and a pointer over the toast or the focus inside it stops the count.
 */
export function Toast({ source, icon, title, body, href, actions, timer }: { source: string; icon?: string; title: ReactNode; body?: string; href?: string; actions: ToastAction[]; timer?: ToastTimer }) {
  const content = (
    <>
      <span className="toast__source">
        {icon !== undefined && <img className="toast__icon" src={icon} alt="" width={16} height={16} />}
        {source}
      </span>
      <strong className="toast__title">{title}</strong>
      {body !== undefined && <span className="toast__body">{body}</span>}
    </>
  )
  const holds =
    timer === undefined
      ? {}
      : {
          onPointerEnter: () => timer.hold('pointer', true),
          onPointerLeave: () => timer.hold('pointer', false),
          onFocus: () => timer.hold('focus', true),
          onBlur: (event: FocusEvent<HTMLDivElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget)) timer.hold('focus', false)
          },
        }
  return (
    <div className="toast" role="status" {...holds}>
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
      {timer !== undefined && (
        <span
          key={timer.view.round}
          className="toast__bar"
          data-running={timer.view.running}
          style={{ '--toast-ms': `${timer.ms}ms` } as CSSProperties}
          aria-hidden
        />
      )}
    </div>
  )
}
