import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { CommandBlock } from '../ui/blocks.js'
import { FieldStrip } from '../ui/FieldStrip.js'
import { secretInput } from '../ui/secret.js'
import { Select } from '../ui/Select.js'
import '../tools/addPackage.css'

export interface MachineTokenTarget {
  machine: string
  /** The machine's name as the hub knows it. */
  name: string
  /** The hub's folder of the account the token is of: the machine's folder is tied to its claude.ai account. */
  account: string
  /** How the page names that account. */
  who: string
}

/**
 * A long token of `claude setup-token` for a machine elsewhere (BTN-1002): the machine checks it with one short turn and
 * keeps it in a new account folder tied to the hub's account, or the refusal shows under the field. `choices` — the hub
 * accounts the token may be of, picked here (BTN-1308: "Add account" on a machine); `onAdded` — after the machine took it.
 */
export function MachineTokenDialog({ target: given, choices, onClose, onAdded = onClose }: {
  target: MachineTokenTarget
  choices?: ReadonlyArray<Pick<MachineTokenTarget, 'account' | 'who'>>
  onClose: () => void
  onAdded?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const { send, sending, failure } = useCommand()
  const [token, setToken] = useState('')
  const [account, setAccount] = useState(given.account)
  const target = { ...given, ...choices?.find((each) => each.account === account) }

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (token.trim() === '' || sending) return
    if (await send('machines/token', { machine: target.machine, account: target.account, token })) onAdded()
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
            {t.account.machineTokenTitle(target.name)}
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="add-package__body">
          {choices !== undefined && choices.length > 1 && (
            <div className="add-package__field">
              <span className="add-package__label">{t.account.machineTokenOf}</span>
              <Select
                className="add-package__input"
                label={t.account.machineTokenOf}
                value={account}
                options={choices.map((each) => ({ value: each.account, label: each.who }))}
                onChange={setAccount}
              />
            </div>
          )}
          <p className="add-package__note">{t.account.machineTokenLead(target.who)}</p>
          <CommandBlock command="claude setup-token" />
          <label className="add-package__field">
            <span className="add-package__label">{t.account.newKey.longToken}</span>
            <FieldStrip line={failure === null ? null : { tone: 'error', text: say(failure) }} fold wide>
              <input
                className="add-package__input add-package__input--mono"
                {...secretInput()}
                value={token}
                aria-invalid={failure !== null}
                onChange={(event) => setToken(event.target.value)}
                autoFocus
              />
            </FieldStrip>
          </label>
          <p className="add-package__note">{t.account.machineTokenLacks}</p>
        </div>
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          <button type="button" className="button" disabled={sending} onClick={onClose}>
            {t.common.cancel}
          </button>
          <button type="submit" className="button button--primary" disabled={sending || token.trim() === ''}>
            {t.account.machineTokenAdd}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
