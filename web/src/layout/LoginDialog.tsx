import { useEffect, useId, useRef } from 'react'
import type { AccountView } from '../../../src/account/model.js'
import { deviceLogin } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { LoginSteps, loginHeading } from './accountParts.js'
import '../tools/addPackage.css'

/**
 * A sign-in in progress, over whatever page is open. The server holds it, so the dialog follows `account.login`
 * rather than a click: it shows in every tab and after a reload, and goes once the sign-in ends.
 * Closing cancels the sign-in: one left running would keep every sign-in button greyed with nothing on screen.
 */
export function LoginDialog({ account }: { account: AccountView }) {
  const { send, sending, failure } = useCommand()
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const { login } = account

  useEffect(() => {
    if (dialog.current?.open !== false) return
    dialog.current.showModal()
    // showModal focuses the first control, the ×: an Enter there would cancel the sign-in.
    dialog.current.querySelector<HTMLElement>('.account__links a, .account__input, .account__actions button')?.focus()
  })

  if (login === null) return null
  const cancel = () => void send('account/cancel')

  // No close on a backdrop click: the user goes to another tab for the link and a stray click on return would end the sign-in.
  return (
    <dialog
      ref={dialog}
      className="add-package"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={title} className="add-package__title">
            {loginHeading(account)}
          </h2>
          <button type="button" className="panel__close" aria-label={t.account.cancelLogin} disabled={sending} onClick={cancel}>
            ×
          </button>
        </header>
        <div className="add-package__body">
          <LoginSteps login={login} device={deviceLogin(account)} sending={sending} send={send} />
          {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
        </div>
      </div>
    </dialog>
  )
}
