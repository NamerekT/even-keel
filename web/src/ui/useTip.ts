import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const CLOSE_DELAY_MS = 150
/** How long the pointer rests on an anchor before its tip opens, so a pass of the mouse over a row opens nothing. */
export const OPEN_DELAY_MS = 700
/** A tip closed this recently keeps the page warm: the next pointed one opens at once, for reading a row of tips. */
export const WARM_MS = 300
const GAP = 6
const EDGE = 8

// Shared by every tip of the page, not kept per tip.
let openTips = 0
let lastClosed = -Infinity

/** How long a pointed anchor waits before its tip opens: nothing while another tip is open or has just closed. */
export function openDelay(now: number, open: number, closedAt: number): number {
  return open > 0 || now - closedAt <= WARM_MS ? 0 : OPEN_DELAY_MS
}

/** Which edge of the anchor the tip lines up with: `end` — the right one, `start` — the left one. */
export type TipAlign = 'start' | 'end'

/**
 * A tip in the top layer under its anchor, closed by Escape or a press elsewhere.
 * `point` opens it after the pointer rests on the anchor (`OPEN_DELAY_MS`), `show` — at once, for focus and a press; `toggle` — for a tip opened only by pressing.
 */
export function useTip<Anchor extends HTMLElement, Tip extends HTMLElement>(enabled = true, align: TipAlign = 'end') {
  const [open, setOpen] = useState(false)
  const anchor = useRef<Anchor>(null)
  const tip = useRef<Tip>(null)
  const closing = useRef<number | undefined>(undefined)
  const opening = useRef<number | undefined>(undefined)
  const shown = open && enabled

  useEffect(
    () => () => {
      window.clearTimeout(closing.current)
      window.clearTimeout(opening.current)
    },
    [],
  )

  useLayoutEffect(() => {
    const element = tip.current
    const owner = anchor.current
    if (!shown || element === null || owner === null) return
    openTips += 1
    element.showPopover()
    place(element, owner.getBoundingClientRect(), align)
    // The tip may sit inside a chain block: a press on it must not start dragging the block.
    const hold = (event: PointerEvent) => event.stopPropagation()
    const away = (event: PointerEvent) => {
      if (!(event.target instanceof Node && owner.contains(event.target))) setOpen(false)
    }
    element.addEventListener('pointerdown', hold)
    document.addEventListener('pointerdown', away)
    return () => {
      element.removeEventListener('pointerdown', hold)
      document.removeEventListener('pointerdown', away)
      if (element.matches(':popover-open')) element.hidePopover()
      openTips -= 1
      lastClosed = performance.now()
    }
  }, [shown, align])

  const settle = () => {
    window.clearTimeout(closing.current)
    window.clearTimeout(opening.current)
  }
  const show = () => {
    settle()
    setOpen(true)
  }
  const point = () => {
    settle()
    const delay = openDelay(performance.now(), openTips, lastClosed)
    if (delay === 0) setOpen(true)
    else opening.current = window.setTimeout(() => setOpen(true), delay)
  }
  const hide = () => {
    settle()
    closing.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }
  const close = () => {
    settle()
    setOpen(false)
  }
  const toggle = () => {
    settle()
    setOpen((was) => !was)
  }

  return { shown, anchor, tip, show, point, hide, close, toggle }
}

/** Below the anchor, lined up with its edge; above it when the viewport ends first. */
function place(element: HTMLElement, at: DOMRect, align: TipAlign) {
  const width = element.offsetWidth
  const height = element.offsetHeight
  const left = Math.min(Math.max(EDGE, align === 'end' ? at.right - width : at.left), window.innerWidth - width - EDGE)
  const below = at.bottom + GAP
  const top = below + height <= window.innerHeight - EDGE ? below : Math.max(EDGE, at.top - GAP - height)
  element.style.left = `${left}px`
  element.style.top = `${top}px`
}
