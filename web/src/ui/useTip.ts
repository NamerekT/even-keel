import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const CLOSE_DELAY_MS = 150
const GAP = 6
const EDGE = 8

/** Which edge of the anchor the tip lines up with: `end` — the right one, `start` — the left one. */
export type TipAlign = 'start' | 'end'

/** A tip in the top layer under its anchor: open while the anchor is pointed at, focused or pressed, closed by Escape or a press elsewhere. */
export function useTip<Anchor extends HTMLElement, Tip extends HTMLElement>(enabled = true, align: TipAlign = 'end') {
  const [open, setOpen] = useState(false)
  const anchor = useRef<Anchor>(null)
  const tip = useRef<Tip>(null)
  const closing = useRef<number | undefined>(undefined)
  const shown = open && enabled

  useEffect(() => () => window.clearTimeout(closing.current), [])

  useLayoutEffect(() => {
    const element = tip.current
    const owner = anchor.current
    if (!shown || element === null || owner === null) return
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
    }
  }, [shown, align])

  const show = () => {
    window.clearTimeout(closing.current)
    setOpen(true)
  }
  const hide = () => {
    window.clearTimeout(closing.current)
    closing.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }
  const close = () => setOpen(false)

  return { shown, anchor, tip, show, hide, close }
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
