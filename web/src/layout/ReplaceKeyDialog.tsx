import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { AccountEntry } from '../../../src/account/model.js'
import { COPILOT } from '../../../src/copilot/name.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useBackdropClose } from '../ui/backdrop.js'
import '../tools/addPackage.css'

/** Copilot's account holds a GitHub token, the others an API key. */
export function keyWord(entry: AccountEntry): 'key' | 'token' {
  return entry.agent === COPILOT ? 'token' : 'key'
}

/**
 * A new key for an API account (BTN-418): the server checks it with the provider and writes it into the same folder,
 * or says why not, and the old key stays.
 */
export function ReplaceKeyDialog({ entry, title, onClose }: { entry: AccountEntry; title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const { send, sending, failure } = useCommand()
  const [key, setKey] = useState('')
  const word = keyWord(entry)

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (key.trim() === '' || sending) return
    if (await send('account/key', { account: entry.key, key })) onClose()
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
      <form className="add-package__frame" onSubmit={(event) => void submit(event)}>
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">
            {title}
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="add-package__body">
          <p className="add-package__note">{t.account.replaceKeyLead}</p>
          <label className="add-package__field">
            <span className="add-package__label">{t.account.newKey[word]}</span>
            <input
              className="add-package__input add-package__input--mono"
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </label>
          {failure !== null && (
            <p className="notice notice--error" role="alert">
              {say(failure)}
            </p>
          )}
        </div>
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          <button type="button" className="button" disabled={sending} onClick={onClose}>
            {t.common.cancel}
          </button>
          <button type="submit" className="button button--primary" disabled={sending || key.trim() === ''}>
            {t.account.replace}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
