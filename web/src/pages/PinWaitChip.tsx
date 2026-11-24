import { t } from '../i18n/index.js'
import type { ChainBlock } from '../state.js'
import { Tipped } from '../ui/Tipped.js'

/**
 * What a task pinned to machines waits for (BTN-1623, `ChainBlock.pinWait`): "waits for <machine>" while its machines
 * are busy or away, the reason in the tip. A pin no machine can serve — its machines gone, or another machine holding
 * the task — is a press that opens the card, where the run's machines change.
 */
export function PinWaitChip({ wait, onOpen }: { wait: NonNullable<ChainBlock['pinWait']>; onOpen: () => void }) {
  const words = t.chain.pinWait
  const names = wait.machines.join(', ')
  if (wait.why === 'busy' || wait.why === 'offline') {
    return (
      <Tipped tip={wait.why === 'busy' ? words.busy(names) : words.offline(names)} inline>
        <span className="chip chip--waiting">{words.waits(names)}</span>
      </Tipped>
    )
  }
  return (
    <Tipped tip={wait.why === 'gone' ? words.goneTip(names) : words.elsewhereTip(names)} inline>
      <button
        type="button"
        className="chip chip--paused block__pin"
        aria-label={`${wait.why === 'gone' ? words.gone(names) : words.elsewhere}: ${words.open}`}
        onClick={(event) => {
          event.stopPropagation()
          onOpen()
        }}
      >
        {wait.why === 'gone' ? words.gone(names) : words.elsewhere}
      </button>
    </Tipped>
  )
}
