import { useId, type ReactNode } from 'react'
import { useTip, type TipAlign } from './useTip.js'
import './tip.css'

interface TippedProps {
  tip: ReactNode
  /** The children hold nothing to focus: the wrapper takes the focus itself, so the tip is reachable from the keyboard. */
  focusable?: boolean
  align?: TipAlign
  className?: string
  children: ReactNode
}

/** Its children with a tip under them: shown at once on pointing, focus or a press, closed by Escape — not the browser's slow `title`. */
export function Tipped({ tip, focusable = false, align = 'end', className, children }: TippedProps) {
  const { shown, anchor, tip: tipRef, show, hide, close } = useTip<HTMLDivElement, HTMLDivElement>(true, align)
  const id = useId()
  return (
    <div
      ref={anchor}
      className={className === undefined ? 'tipped' : `tipped ${className}`}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={id}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={show}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !shown) return
        event.preventDefault()
        event.stopPropagation()
        close()
      }}
    >
      {children}
      <div id={id} hidden>
        {tip}
      </div>
      {shown && (
        <div ref={tipRef} popover="manual" className="tip" role="tooltip">
          {tip}
        </div>
      )}
    </div>
  )
}
