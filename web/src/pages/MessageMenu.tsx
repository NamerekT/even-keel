import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { t } from '../i18n/index.js'
import '../ui/moreMenu.css'

/** How long a finger rests on the message before its menu opens: a phone's own long press. */
export const LONG_PRESS_MS = 500
/** A finger that moves this far scrolls the feed rather than presses. */
const SLOP_PX = 10
const EDGE = 8

interface Item {
  label: string
  pick: () => void
}

/**
 * The last message of the agent with a menu of its own (BTN-1363): a right click or a long press opens "Accept as answer"
 * while `onAccept` is given, and "Copy text" where the page has a clipboard. Text selected in the message keeps the
 * browser's menu, so the selection can be copied; with no item the browser's menu stays too.
 */
export function MessageMenu({ text, onAccept, children }: { text: string; onAccept?: () => void; children: ReactNode }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLUListElement>(null)
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const clipboard = typeof navigator !== 'undefined' && navigator.clipboard !== undefined
  const items: Item[] = [
    ...(onAccept === undefined ? [] : [{ label: t.session.accept, pick: onAccept }]),
    ...(clipboard ? [{ label: t.session.chat.message.copy, pick: () => void navigator.clipboard.writeText(text).catch(() => {}) }] : []),
  ]

  const cancelPress = () => {
    if (press.current !== null) clearTimeout(press.current.timer)
    press.current = null
  }
  useEffect(() => cancelPress, [])

  useLayoutEffect(() => {
    const element = menu.current
    if (at === null || element === null) return
    element.showPopover()
    const left = Math.min(Math.max(EDGE, at.x), window.innerWidth - element.offsetWidth - EDGE)
    const top = at.y + element.offsetHeight <= window.innerHeight - EDGE ? at.y : Math.max(EDGE, at.y - element.offsetHeight)
    element.style.left = `${left}px`
    element.style.top = `${top}px`
    element.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
    const away = (event: Event) => {
      if (!(event.target instanceof Node && element.contains(event.target))) setAt(null)
    }
    const shut = () => setAt(null)
    document.addEventListener('pointerdown', away)
    document.addEventListener('scroll', away, true)
    window.addEventListener('resize', shut)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', shut)
      if (element.matches(':popover-open')) element.hidePopover()
    }
  }, [at])

  const open = (x: number, y: number) => {
    cancelPress()
    if (at === null) setAt({ x, y })
  }

  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (items.length === 0 || selectedInside(root.current)) return
    event.preventDefault()
    open(event.clientX, event.clientY)
  }

  // A phone that fires no `contextmenu` on a long press (Safari on iOS) gets it from the finger's own timer.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || items.length === 0) return
    cancelPress()
    const { clientX: x, clientY: y } = event
    press.current = {
      x,
      y,
      timer: setTimeout(() => {
        // The long press began selecting a word; the menu takes its place.
        document.getSelection()?.removeAllRanges()
        open(x, y)
      }, LONG_PRESS_MS),
    }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const started = press.current
    if (started !== null && Math.hypot(event.clientX - started.x, event.clientY - started.y) > SLOP_PX) cancelPress()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      // The chat window around would take the same Escape as its own close.
      event.stopPropagation()
      setAt(null)
    } else if (event.key === 'Tab') {
      setAt(null)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const buttons = [...(menu.current?.querySelectorAll<HTMLElement>('button') ?? [])]
      const now = buttons.findIndex((button) => button === document.activeElement)
      buttons[(now + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
    }
  }

  return (
    <div
      ref={root}
      className="message-menu"
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
    >
      {children}
      <ul ref={menu} popover="manual" role="menu" aria-label={t.session.chat.message.menu} className="more-menu__list" onKeyDown={onKeyDown}>
        {at !== null &&
          items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className="more-menu__item"
                onClick={() => {
                  setAt(null)
                  item.pick()
                }}
              >
                <span className="more-menu__label">{item.label}</span>
              </button>
            </li>
          ))}
      </ul>
    </div>
  )
}

function selectedInside(element: HTMLElement | null): boolean {
  const selection = document.getSelection()
  if (element === null || selection === null || selection.isCollapsed || selection.toString().trim() === '') return false
  return element.contains(selection.anchorNode) || element.contains(selection.focusNode)
}
