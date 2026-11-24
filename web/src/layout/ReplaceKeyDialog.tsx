import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { AccountEntry } from '../../../src/account/model.js'
import { COPILOT } from '../../../src/copilot/name.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { CommandBlock } from '../ui/blocks.js'
import { Field } from '../tools/AddPackage.js'
import { secretInput } from '../ui/secret.js'
import { CloseIcon } from '../ui/icons.js'
import '../tools/addPackage.css'

/** Copilot's account holds a GitHub token, a Claude subscription may run on a long token (BTN-1005), the others hold an API key. */
export function keyWord(entry: AccountEntry): 'key' | 'token' | 'longToken' {
  if (entry.longToken !== undefined) return 'longToken'
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
            <CloseIcon />
          </button>
        </header>
        <div className="add-package__body">
          {word === 'longToken' && <CommandBlock command="claude setup-token" />}
          {/* A refusal here is about the key (its form, the provider's answer, another organization), so it goes under it. */}
          <Field
            label={t.account.newKey[word]}
            hint={word === 'longToken' ? t.account.replaceTokenLead : t.account.replaceKeyLead}
            error={failure === null ? undefined : say(failure)}
          >
            {(id) => (
              <input
                id={id}
                className="add-package__input add-package__input--mono"
                {...secretInput()}
                value={key}
                aria-invalid={failure !== null}
                onChange={(event) => setKey(event.target.value)}
                autoFocus
              />
            )}
          </Field>
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
