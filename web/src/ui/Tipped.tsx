import { createElement, useId, type KeyboardEvent, type ReactNode } from 'react'
import { useTip, type TipAlign } from './useTip.js'
import './tip.css'

interface TippedProps {
  tip: ReactNode
  /** The children hold nothing to focus: the wrapper takes the focus itself, so the tip is reachable from the keyboard. */
  focusable?: boolean
  align?: TipAlign
  /** Spans instead of divs, for a place that takes only phrasing content, such as inside a button; the tip then holds only spans too. */
  inline?: boolean
  /** Keep the tip shut, e.g. while a menu opened by the same press is up. */
  off?: boolean
  className?: string
  children: ReactNode
}

/** Its children with a tip under them: shown at once on pointing, focus or a press, closed by Escape — not the browser's slow `title`. */
export function Tipped({ tip, focusable = false, align = 'end', inline = false, off = false, className, children }: TippedProps) {
  const { shown, anchor, tip: tipRef, show, hide, close } = useTip<HTMLElement, HTMLElement>(!off, align)
  const id = useId()
  const tag = inline ? 'span' : 'div'
  return createElement(
    tag,
    {
      ref: anchor,
      className: className === undefined ? 'tipped' : `tipped ${className}`,
      tabIndex: focusable ? 0 : undefined,
      'aria-describedby': id,
      onMouseEnter: show,
      onMouseLeave: hide,
      onFocus: show,
      onBlur: hide,
      onClick: show,
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || !shown) return
        event.preventDefault()
        event.stopPropagation()
        close()
      },
    },
    children,
    createElement(tag, { id, hidden: true }, tip),
    shown && createElement(tag, { ref: tipRef, popover: 'manual', className: 'tip', role: 'tooltip' }, tip),
  )
}
