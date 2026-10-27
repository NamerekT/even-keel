import { t } from '../i18n/index.js'
import type { BlockLamp } from '../state.js'

export function Lamp({ lamp, label }: { lamp: BlockLamp; label?: string }) {
  return <span className={`lamp lamp--${lamp}`} role="img" aria-label={label ?? t.lamp[lamp]} title={label ?? t.lamp[lamp]} />
}
