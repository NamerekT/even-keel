import { t } from '../i18n/index.js'
import type { ChainBlock } from '../state.js'
import { Tipped } from '../ui/Tipped.js'
import type { TagWait } from '../ui/MachineTag.js'

type Wait = NonNullable<ChainBlock['pinWait']>

/** What the pinned machines' tag says of the wait (BTN-1807): its machines busy or away; absent — the chip says it. */
export function tagWait(wait: Wait | undefined): TagWait | undefined {
  return wait?.why === 'busy' || wait?.why === 'offline' ? wait.why : undefined
}

/**
 * A pin no machine can serve (BTN-1623, `ChainBlock.pinWait`) — its machines gone, or another machine holding the task —
 * is a press that opens the card, where the run's machines change. Busy or away machines are no chip: the tag says it.
 */
export function PinWaitChip({ wait, onOpen }: { wait: Wait; onOpen: () => void }) {
  if (wait.why === 'busy' || wait.why === 'offline') return null
  const words = t.chain.pinWait
  const names = wait.machines.join(', ')
  const label = wait.why === 'gone' ? words.gone(names) : words.elsewhere
  return (
    <Tipped tip={wait.why === 'gone' ? words.goneTip(names) : words.elsewhereTip(names)} inline>
      <button
        type="button"
        className="chip chip--paused block__pin"
        aria-label={`${label}: ${words.open}`}
        onClick={(event) => {
          event.stopPropagation()
          onOpen()
        }}
      >
        {label}
      </button>
    </Tipped>
  )
}
