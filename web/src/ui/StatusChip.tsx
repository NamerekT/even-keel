import { t } from '../i18n/index.js'
import type { ChainStatus } from '../state.js'
import type { ChainWait } from '../waits.js'
import { Tipped } from './Tipped.js'

type Props = { status: ChainStatus; wait?: ChainWait; reason?: boolean; className?: string }

/**
 * A running chain that waits before its next task says so, the first thing it waits for in its tip (BTN-657, BTN-1374).
 * `reason={false}` where the block's own wait line sits right under the chip (a home card). A queued chain carries its
 * place as a grey `.count-badge`. `className` makes it a part of a bigger block, such as the project head's segment
 * before the chain's buttons.
 */
export function StatusChip({ status, wait, reason = true, className }: Props) {
  const of = (kind: string) => (className === undefined ? `chip chip--${kind}` : `chip chip--${kind} ${className}`)
  if (status.kind === 'running' && wait !== undefined) {
    return (
      <Tipped tip={t.chainStatus.waitsFor(t.chainStatus.waitFor[wait.kind])} off={!reason} focusable={reason} inline className={of('waiting')}>
        {t.chainStatus.waiting}
      </Tipped>
    )
  }
  if (status.kind === 'queued') {
    return (
      <Tipped tip={t.chainStatus.position(status.position)} focusable inline className={`${of('queued')} chip--counted`}>
        {t.chainStatus.queued}
        <span className="count-badge">{status.position}</span>
      </Tipped>
    )
  }
  return <span className={of(status.kind)}>{t.chainStatus[status.kind]}</span>
}
