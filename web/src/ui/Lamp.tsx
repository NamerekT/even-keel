import { t } from '../i18n/index.js'
import type { BlockLamp } from '../state.js'

export function Lamp({ lamp }: { lamp: BlockLamp }) {
  return <span className={`lamp lamp--${lamp}`} role="img" aria-label={t.lamp[lamp]} title={t.lamp[lamp]} />
}
