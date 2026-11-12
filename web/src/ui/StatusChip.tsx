import { t } from '../i18n/index.js'
import type { ChainStatus } from '../state.js'
import type { ChainWait } from '../waits.js'

type Props = { status: ChainStatus; wait?: ChainWait; reason?: boolean; className?: string }

/**
 * A running chain that waits before its next task says so, with the first thing it waits for (BTN-657). `reason={false}`
 * where the block's own wait line sits right under the chip and the head has no room for both (a home card).
 * `className` makes it a part of a bigger block, such as the project head's segment before the chain's buttons.
 */
export function StatusChip({ status, wait, reason = true, className }: Props) {
  const of = (kind: string) => (className === undefined ? `chip chip--${kind}` : `chip chip--${kind} ${className}`)
  if (status.kind === 'running' && wait !== undefined) {
    return (
      <span className={of('waiting')}>
        {t.chainStatus.waiting}
        {reason && <span className="chip__extra"> · {t.chainStatus.waitFor[wait.kind]}</span>}
      </span>
    )
  }
  return (
    <span className={of(status.kind)}>
      {t.chainStatus[status.kind]}
      {status.kind === 'queued' && <span className="chip__extra"> · {t.chainStatus.position(status.position)}</span>}
    </span>
  )
}
