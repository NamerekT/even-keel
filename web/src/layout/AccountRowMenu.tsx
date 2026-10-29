import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { removeProblem, type AccountEntry, type AccountView } from '../../../src/account/model.js'
import { accountName } from '../accountName.js'
import { say, t } from '../i18n/index.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { usePopoverMenu } from '../ui/usePopoverMenu.js'
import { rolesOf } from './AccountRoles.js'
import { removeQuestion, type Send } from './accountParts.js'

interface Props {
  entry: AccountEntry
  view: AccountView
  sending: boolean
  send: Send
  children: ReactNode
  fresh?: boolean
}

/** A real button covers the row; the independent details sit above it, never inside another button. */
export function AccountRowMenu({ entry, view, sending, send, children, fresh = false }: Props) {
  const clickX = useRef<number | undefined>(undefined)
  const { open, setOpen, root, button, menu, onKeyDown } = usePopoverMenu<HTMLUListElement>(
    (element, at) => placeRowMenu(element, at, clickX.current),
  )
  const [renaming, setRenaming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const name = accountName(entry, view.accounts)
  const roles = rolesOf(entry, view, send)
  const held = roles.filter((role) => role.held)
  const problem = removeProblem(view, entry.key)
  const pick = (action: () => void) => { setOpen(false); action() }
  const toggleMenu = (event: MouseEvent<HTMLElement>) => {
    clickX.current = event.detail === 0 ? undefined : event.clientX
    setOpen(!open)
  }

  return (
    <div ref={root} className={`account-row${held.length === 0 ? ' account-row--unused' : ''}${fresh ? ' account-row--fresh' : ''}`}
      onClick={(event) => {
        if (sending || (event.target as HTMLElement).closest('button, a, input, dialog, [role="menu"], .account-detail, .account-shared, .account-overage-warning')) return
        toggleMenu(event)
      }}>
      <button ref={button} type="button" className="account-row__button"
        aria-label={t.account.more(name)} aria-haspopup="menu" aria-expanded={open}
        disabled={sending} onClick={toggleMenu} />
      {children}
      <ul ref={menu} popover="manual" role="menu" className="roles__menu account-row__menu" onKeyDown={onKeyDown}>
        {open && <>
          <li role="none" className="account-row__menu-title">{t.account.usedByLabel}</li>
          {roles.map((role) => (
            <li key={role.label} role="none">
              <button type="button" role="menuitemcheckbox" aria-checked={role.held}
                aria-disabled={sending || (!role.held && role.problem !== undefined)}
                className="roles__offer" onClick={() => {
                  if (sending || role.held || role.problem !== undefined) return
                  pick(() => void role.pick())
                }}>
                <span className="roles__label"><role.icon />{role.label}{role.held && <span className="account-row__check">✓</span>}</span>
                {!role.held && <span className="roles__note">{role.problem === undefined ? role.note : say(role.problem)}</span>}
              </button>
            </li>
          ))}
          {held.length === 0 && <li role="none" className="roles__here">✓ {t.account.rolesNone}</li>}
          <li role="separator" className="account-row__separator" />
          <li role="none"><button type="button" role="menuitem" className="roles__offer" onClick={() => pick(() => setRenaming(true))}>{t.account.renameAction}</button></li>
          <li role="none"><button type="button" role="menuitem" className="roles__offer account-row__remove"
            aria-disabled={problem !== undefined || entry.removing}
            onClick={() => { if (problem === undefined && !entry.removing) pick(() => setRemoving(true)) }}>
            {t.common.remove}{problem !== undefined && <span className="roles__note">{say(problem)}</span>}
          </button></li>
        </>}
      </ul>
      {renaming && <RenameAccount entry={entry} name={name} send={send} sending={sending} onClose={() => { setRenaming(false); button.current?.focus() }} />}
      {removing && <ConfirmDialog title={name} question={removeQuestion(entry)} confirm={t.common.remove} cancel={t.account.keep}
        busy={sending} onClose={() => { setRemoving(false); button.current?.focus() }}
        onConfirm={() => void send('account/remove', { account: entry.key }).then((ok) => { if (ok) setRemoving(false) })} />}
    </div>
  )
}

function placeRowMenu(element: HTMLElement, at: DOMRect, clickX?: number) {
  const edge = 8
  const width = element.offsetWidth
  const height = element.offsetHeight
  element.style.left = `${Math.max(edge, Math.min(clickX ?? at.left + at.width / 3, window.innerWidth - width - edge))}px`
  element.style.top = `${at.bottom + height + edge <= window.innerHeight ? at.bottom + 4 : Math.max(edge, at.top - height - 4)}px`
}

function RenameAccount({ entry, name, send, sending, onClose }: { entry: AccountEntry; name: string; send: Send; sending: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const [text, setText] = useState(entry.name ?? '')
  useEffect(() => { dialog.current?.showModal() }, [])
  return (
    <dialog ref={dialog} className="add-package add-package--narrow" aria-labelledby={heading}
      onCancel={(event) => { event.preventDefault(); onClose() }}>
      <form className="add-package__frame" onSubmit={(event) => {
        event.preventDefault()
        void send('account/name', { account: entry.key, name: text.trim() }).then((ok) => { if (ok) onClose() })
      }}>
        <header className="add-package__head"><h2 id={heading} className="add-package__title">{t.account.renameAction}</h2></header>
        <div className="add-package__body">
          <label className="account-rename">{t.account.keyName}
            <input autoFocus className="account__input" maxLength={80} value={text} placeholder={name} onChange={(event) => setText(event.target.value)} />
          </label>
        </div>
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          <button type="button" className="button" onClick={onClose} disabled={sending}>{t.common.cancel}</button>
          <button type="submit" className="button button--primary" disabled={sending}>{t.common.apply}</button>
        </footer>
      </form>
    </dialog>
  )
}
