import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { AccountEntry } from '../../../src/account/model.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { FieldStrip } from '../ui/FieldStrip.js'
import { secretInput } from '../ui/secret.js'
import '../tools/addPackage.css'

/**
 * An OpenRouter account's management key, only for its balance (BTN-868): the server reads the balance with it before it
 * keeps it, or says why not. With a key set, the dialog may also remove it.
 */
export function ManagementKeyDialog({ entry, title, onClose }: { entry: AccountEntry; title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const { send, sending, failure } = useCommand()
  const [key, setKey] = useState('')

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (key.trim() === '' || sending) return
    if (await send('account/management-key', { account: entry.key, key })) onClose()
  }
  const remove = async () => {
    if (sending) return
    if (await send('account/management-key', { account: entry.key, key: null })) onClose()
  }

  return (
    <dialog
      ref={dialog}
      className="add-package add-package--narrow"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      {...backdrop}
    >
      <form className="add-package__frame" onSubmit={(event) => void save(event)}>
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">
            {title}
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="add-package__body">
          <p className="add-package__note">{t.account.managementKeyLead}</p>
          {entry.managementKey === true && <p className="add-package__note">{t.account.managementKeyHeld}</p>}
          <label className="add-package__field">
            <span className="add-package__label">{t.account.managementKeyField}</span>
            <FieldStrip line={failure === null ? null : { tone: 'error', text: say(failure) }} fold wide>
              <input
                className="add-package__input add-package__input--mono"
                {...secretInput()}
                value={key}
                aria-invalid={failure !== null}
                onChange={(event) => setKey(event.target.value)}
                autoFocus
              />
            </FieldStrip>
          </label>
        </div>
        <footer className="add-package__foot">
          {entry.managementKey === true && (
            <button type="button" className="button button--danger" disabled={sending} onClick={() => void remove()}>
              {t.common.remove}
            </button>
          )}
          <span className="add-package__spacer" />
          <button type="button" className="button" disabled={sending} onClick={onClose}>
            {t.common.cancel}
          </button>
          <button type="submit" className="button button--primary" disabled={sending || key.trim() === ''}>
            {t.account.managementKeySave}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
