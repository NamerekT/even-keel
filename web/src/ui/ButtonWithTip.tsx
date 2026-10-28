import { useId, type ReactNode } from 'react'
import { QuestionIcon } from './icons.js'
import { useTip } from './useTip.js'
import './tip.css'
import './buttonWithTip.css'

/** An action and an attached help button; only a press opens or closes its tip. */
export function ButtonWithTip({ action, tip, label, className = '' }: { action: ReactNode; tip: ReactNode; label: string; className?: string }) {
  const { shown, anchor, tip: tipRef, toggle, close } = useTip<HTMLDivElement, HTMLDivElement>()
  const id = useId()
  return (
    <div className={`button-with-tip ${className}`}>
      {action}
      <div ref={anchor} className="button-with-tip__help">
        <button
          type="button"
          className="button button-with-tip__trigger"
          aria-label={label}
          aria-describedby={id}
          aria-expanded={shown}
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !shown) return
            event.preventDefault()
            event.stopPropagation()
            close()
          }}
        >
          <QuestionIcon />
        </button>
        <div id={id} hidden>{tip}</div>
        {shown && <div ref={tipRef} popover="manual" className="tip" role="tooltip">{tip}</div>}
      </div>
    </div>
  )
}
