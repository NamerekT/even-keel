import type { ReactNode } from 'react'
import { t } from '../i18n/index.js'
import { Band, type BandTone } from '../ui/blocks.js'
import { CloseIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'

interface Props {
  tone?: BandTone
  /** A few words; what explains them goes into `tip` or into the tip of an action. */
  children: ReactNode
  tip?: ReactNode
  /** The buttons left of ✕. */
  actions?: ReactNode
  /** What ✕ does when it is more than closing, as its tip. */
  closeTip?: string
  onClose: () => void
}

/**
 * A message over the chat's field (BTN-1363): a card with a short line at the left and its buttons with ✕ at the right,
 * as a desktop chat shows a notice over its input. Everything the field has to say but the status line goes so.
 */
export function ComposerBanner({ tone = 'note', children, tip, actions, closeTip, onClose }: Props) {
  const close = (
    <button type="button" className="chat-banner__close" aria-label={t.session.chat.banner.close} onClick={onClose}>
      <CloseIcon />
    </button>
  )
  return (
    <Band
      tone={tone}
      className="chat-banner"
      action={
        <>
          {actions}
          {closeTip === undefined ? close : <Tipped inline tip={closeTip}>{close}</Tipped>}
        </>
      }
    >
      <div role={tone === 'error' ? 'alert' : undefined} className="chat-banner__text">
        {tip === undefined ? children : <Tipped inline focusable tip={tip}>{children}</Tipped>}
      </div>
    </Band>
  )
}
