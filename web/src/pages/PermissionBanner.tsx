import type { Ask } from '../../../src/sessions/ask.js'
import { t } from '../i18n/index.js'
import { Tipped } from '../ui/Tipped.js'
import './permission.css'

interface Props {
  /** A permission ask (`ask.permission` set): its one question's first option allows the call, the second refuses it. */
  ask: Ask
  disabled: boolean
  /** The option's label as the server wrote it, to go as the question's answer. */
  onDecide: (label: string) => void
}

/**
 * A tool call the session waits to have approved, over the chat's field (BTN-1769): what it wants to run, the call
 * itself in a scrolling block, Allow and Deny under it. Words typed in the field go with either press.
 */
export function PermissionBanner({ ask, disabled, onDecide }: Props) {
  const question = ask.questions[0]!
  const [allow, deny] = question.options
  const call = allow?.preview ?? ''
  const permission = ask.permission!
  return (
    <div className={`permission${disabled ? ' permission--off' : ''}`} role="group" aria-label={t.session.chat.permission.title(permission.tool, permission.several)}>
      <div className="permission__head">{t.session.chat.permission.title(permission.tool, permission.several)}</div>
      {call !== '' && <pre className="permission__call">{call}</pre>}
      <div className="permission__actions">
        {deny !== undefined && (
          <Tipped inline tip={t.session.chat.permission.denyTip}>
            <button type="button" className="button" disabled={disabled} onClick={() => onDecide(deny.label)}>
              {t.session.chat.permission.deny}
            </button>
          </Tipped>
        )}
        {allow !== undefined && (
          <Tipped inline tip={t.session.chat.permission.allowTip}>
            <button type="button" className="button button--primary" disabled={disabled} onClick={() => onDecide(allow.label)}>
              {t.session.chat.permission.allow}
            </button>
          </Tipped>
        )}
      </div>
    </div>
  )
}
