import { t } from '../i18n/index.js'
import type { ChainStatus } from '../state.js'

export function StatusChip({ status }: { status: ChainStatus }) {
  return (
    <span className={`chip chip--${status.kind}`}>
      {t.chainStatus[status.kind]}
      {status.kind === 'queued' && <span className="chip__extra"> · {t.chainStatus.position(status.position)}</span>}
    </span>
  )
}
