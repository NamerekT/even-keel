import { formatLineTime } from '../format.js'
import { t } from '../i18n/index.js'
import { ClockIcon, DoubleCheckIcon, UnsentIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import type { Delivery } from './sentLines.js'

/** The mark left of the time under the user's message (BTN-1362): a clock, two green checks or a red sign, its words in a tip. */
export function DeliveryMark({ delivery, at }: { delivery: Delivery; at: string }) {
  const words = t.session.chat.delivery
  const tip = delivery === 'delivered' ? words.delivered(at === '' ? null : formatLineTime(at)) : words[delivery]
  return (
    <Tipped inline focusable align="end" className={`delivery delivery--${delivery}`} tip={tip}>
      <span className="delivery__icon" role="img" aria-label={tip}>
        {delivery === 'delivering' ? <ClockIcon /> : delivery === 'delivered' ? <DoubleCheckIcon /> : <UnsentIcon />}
      </span>
    </Tipped>
  )
}
