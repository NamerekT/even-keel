import { t } from '../i18n/index.js'
import type { BlockLamp } from '../state.js'
import './lamp.css'

const SIGNS: Partial<Record<BlockLamp, string>> = {
  working: 'M3.5 2.5 7.5 5 3.5 7.5z',
  waiting: 'M3.5 3.4a1.5 1.5 0 1 1 2.1 1.4c-.6.3-.6.6-.6 1M5 7.6v.1',
  stopped: 'M3 3h4v4H3z',
  handoff: 'M2.5 5h5M5 2.5 7.5 5 5 7.5',
  fixed: 'M2.5 2.5 7.5 7.5M7.5 2.5 2.5 7.5',
}

export function Lamp({ lamp, label }: { lamp: BlockLamp; label?: string }) {
  return (
    <span className={`lamp lamp--${lamp}`} role="img" aria-label={label ?? t.lamp[lamp]} title={label ?? t.lamp[lamp]}>
      {SIGNS[lamp] && <svg className="lamp__sign" viewBox="0 0 10 10" aria-hidden="true"><path d={SIGNS[lamp]} /></svg>}
    </span>
  )
}
