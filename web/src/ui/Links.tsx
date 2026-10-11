import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../i18n/index.js'
import type { LinkedTask, TaskLinks } from '../state.js'
import { KeyIcon, LockIcon } from './icons.js'
import { Lamp } from './Lamp.js'
import './links.css'

const CLOSE_DELAY_MS = 150
const GAP = 6
const EDGE = 8

/** Two counters, the tasks this one waits for and the tasks waiting for it; a pointed counter lists them. */
export function Links({ links, onCard }: { links: TaskLinks; onCard: (task: string) => void }) {
  return (
    <span className="links">
      <Count kind="blockers" title={t.card.blockedBy} icon={<LockIcon />} items={links.blockers} onCard={onCard} />
      <Count kind="dependents" title={t.card.blocks} icon={<KeyIcon />} items={links.dependents} onCard={onCard} />
    </span>
  )
}

interface CountProps {
  kind: 'blockers' | 'dependents'
  title: string
  icon: ReactNode
  items: LinkedTask[]
  onCard: (task: string) => void
}

function Count({ kind, title, icon, items, onCard }: CountProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const tip = useRef<HTMLSpanElement>(null)
  const closing = useRef<number | undefined>(undefined)
  const any = items.length > 0
  const shown = open && any

  useEffect(() => () => window.clearTimeout(closing.current), [])

  useLayoutEffect(() => {
    const element = tip.current
    if (!shown || element === null || anchor.current === null) return
    element.showPopover()
    place(element, anchor.current.getBoundingClientRect())
    // The tip sits inside a chain block: a press on it must not start dragging the block.
    const hold = (event: PointerEvent) => event.stopPropagation()
    element.addEventListener('pointerdown', hold)
    return () => {
      element.removeEventListener('pointerdown', hold)
      if (element.matches(':popover-open')) element.hidePopover()
    }
  }, [shown])

  const show = () => {
    window.clearTimeout(closing.current)
    setOpen(true)
  }
  const hide = () => {
    window.clearTimeout(closing.current)
    closing.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }

  return (
    <span
      ref={anchor}
      className={`links__count links__count--${kind}${any ? '' : ' links__count--none'}`}
      tabIndex={any ? 0 : undefined}
      aria-label={`${title}: ${any ? items.map((item) => item.id).join(', ') : 0}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
    >
      {icon}
      <span className="links__number">{items.length}</span>
      {shown && (
        <span ref={tip} popover="manual" className="links__tip" role="tooltip">
          <span className="links__heading">
            {title} <span className="links__total">{items.length}</span>
          </span>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="links__task"
              tabIndex={-1}
              onClick={() => {
                setOpen(false)
                onCard(item.id)
              }}
            >
              <Lamp lamp={item.lamp} />
              <span className="links__key">{item.id}</span>
              {item.title !== null && <span className="links__title">{item.title}</span>}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

/** Below the counter, its right edge on the counter's; above it when the viewport ends first. */
function place(element: HTMLElement, at: DOMRect) {
  const width = element.offsetWidth
  const height = element.offsetHeight
  const left = Math.min(Math.max(EDGE, at.right - width), window.innerWidth - width - EDGE)
  const below = at.bottom + GAP
  const top = below + height <= window.innerHeight - EDGE ? below : Math.max(EDGE, at.top - GAP - height)
  element.style.left = `${left}px`
  element.style.top = `${top}px`
}
