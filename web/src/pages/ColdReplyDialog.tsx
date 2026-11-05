import { useEffect, useId, useRef } from 'react'
import { CLAUDE } from '../../../src/claude/name.js'
import { formatAgo, formatTokens } from '../format.js'
import { t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import '../tools/addPackage.css'
import { useBackdropClose } from '../ui/backdrop.js'

interface Props {
  agent: string
  /** When the cache went cold and the session's context in tokens. */
  cold: { since: string; tokens: number }
  /** The chain runs the task: a new session with the message can start. */
  renews: boolean
  onRenew: () => void
  onReply: () => void
  onClose: () => void
}

/**
 * A reply to a session whose cache went cold (BTN-757): a new session with the handoff and the message, the primary
 * choice, or the reply to this session as before; the cancel keeps the text and the files in the chat.
 */
export function ColdReplyDialog({ agent, cold, renews, onRenew, onReply, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const now = useNow(30_000)
  const text = t.session.chat.cold
  const says = renews ? text.question : text.loose

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
    primary.current?.focus()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="add-package"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      {...backdrop}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">
            {text.title}
          </h2>
        </header>
        <div className="add-package__body">
          <p className="add-package__question">{says(formatAgo(cold.since, now), formatTokens(cold.tokens), agent === CLAUDE)}</p>
        </div>
        <footer className="add-package__foot add-package__foot--wrap">
          <button type="button" className="button" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button type="button" ref={renews ? undefined : primary} className={renews ? 'button' : 'button button--primary'} onClick={onReply}>
            {text.reply}
          </button>
          {renews && (
            <button type="button" ref={primary} className="button button--primary" onClick={onRenew}>
              {text.renew}
            </button>
          )}
        </footer>
      </div>
    </dialog>
  )
}
