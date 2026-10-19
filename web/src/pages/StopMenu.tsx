import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { t } from '../i18n/index.js'
import { ChevronIcon } from '../ui/icons.js'
import { place } from '../ui/Select.js'
import './stop.css'

interface StopMenuProps {
  className: string
  /** Pressable: the chain is running or paused. */
  enabled: boolean
  /** Why it cannot be pressed now. */
  off: string | undefined
  sending: boolean
  /** "After this task" is on. */
  stopsAfter: boolean
  /** The task the chain stops after, if it has one now. */
  task: string | null
  stop: () => void
  setStopAfter: (on: boolean) => void
}

/**
 * "Stop" as one button with a menu: now, or after the current task (and back). Its head line says that neither
 * touches the session, so the button is not feared mid-turn.
 */
export function StopMenu({ className, enabled, off, sending, stopsAfter, task, stop, setStopAfter }: StopMenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLUListElement>(null)
  const shown = open && enabled

  useLayoutEffect(() => {
    const element = menu.current
    const owner = button.current
    if (!shown || element === null || owner === null) return
    element.showPopover()
    place(element, owner.getBoundingClientRect())
    element.querySelector<HTMLButtonElement>('button')?.focus()
    const away = (event: Event) => {
      if (!(event.target instanceof Node && root.current?.contains(event.target))) setOpen(false)
    }
    // Only a scroll that moves the button closes it: the session's activity scrolls by itself all the time.
    const moved = (event: Event) => {
      if (event.target instanceof Node && event.target.contains(owner)) setOpen(false)
    }
    const shut = () => setOpen(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('scroll', moved, true)
    window.addEventListener('resize', shut)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('scroll', moved, true)
      window.removeEventListener('resize', shut)
      if (element.matches(':popover-open')) element.hidePopover()
    }
  }, [shown])

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      button.current?.focus()
    } else if (event.key === 'Tab') {
      setOpen(false)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      const at = items.findIndex((item) => item === document.activeElement)
      const next = at + (event.key === 'ArrowDown' ? 1 : -1)
      items[(next + items.length) % items.length]?.focus()
    }
  }

  const pick = (action: () => void) => () => {
    setOpen(false)
    action()
  }
  const item = (label: string, note: string, onClick: () => void) => (
    <li role="none">
      <button type="button" role="menuitem" className="stop__item" onClick={pick(onClick)}>
        <span className="stop__label">{label}</span>
        <span className="stop__note">{note}</span>
      </button>
    </li>
  )

  return (
    <div className="stop" ref={root}>
      <button
        ref={button}
        type="button"
        className={`${className} stop__button`}
        aria-haspopup="menu"
        aria-expanded={shown}
        disabled={sending || !enabled}
        title={enabled ? undefined : off}
        onClick={() => setOpen(!open)}
      >
        {t.project.stop}
        <ChevronIcon />
      </button>
      <ul ref={menu} popover="manual" role="menu" className="stop__menu" onKeyDown={onKeyDown}>
        {shown && (
          <>
            <li role="none" className="stop__keeps">
              {t.project.stopKeeps}
            </li>
            {item(t.project.stopNow, t.project.stopNowNote, stop)}
            {stopsAfter
              ? item(t.project.keepGoing, t.project.keepGoingNote, () => setStopAfter(false))
              : item(t.project.stopAfter, t.project.stopAfterNote(task), () => setStopAfter(true))}
          </>
        )}
      </ul>
    </div>
  )
}
