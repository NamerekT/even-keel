import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { GitSetupView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { IdentityFields, useIdentityForm } from './SetupGit.js'
import '../tools/addPackage.css'

/**
 * "Set them" under `git.noIdentity` (BTN-1094): a dialog over the page with the setup Git step's name and e-mail, saved
 * by the same command, so a wizard or a creation window keeps everything typed. `onSaved` runs once git took them —
 * the wizard checks its field again, the creation window retries its failed step. Nothing without a git that starts.
 * Opening it reads git again, and Save takes the fields once both are filled, even the same values the view showed.
 */
export function IdentityButton({ className, onSaved }: { className: string; onSaved?: () => void }) {
  const { state } = useLive()
  const [open, setOpen] = useState(false)
  const git = state?.git
  if (git === undefined || git.version === null) return null
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {t.fix.identity}
      </button>
      {open && (
        <IdentityDialog
          git={git}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false)
            onSaved?.()
          }}
        />
      )}
    </>
  )
}

function IdentityDialog({ git, onClose, onSaved }: { git: GitSetupView; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const { command } = useLive()
  const form = useIdentityForm(git, true)
  const text = t.setup.git

  // The view is read only at the start and on "Check again", so git's name may have gone since (BTN-1104).
  // Once per opening: `command` is a new function every render.
  useEffect(() => void command('git/check').catch(() => {}), [])

  useEffect(() => {
    const box = dialog.current
    if (box === null || box.open) return
    box.showModal()
    // The cursor goes into the first blank field, not onto the close button `showModal` picks.
    ;[...box.querySelectorAll('input')].find((input) => input.value === '')?.focus()
  }, [])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    // A form inside another dialog's form must not submit that one too.
    event.stopPropagation()
    if (form.ready && (await form.save())) onSaved()
  }

  // Over another modal (the creation window) the dialog goes to the body, as the top layer does anyway.
  return createPortal(
    <dialog
      ref={dialog}
      className="add-package add-package--narrow"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      {...backdrop}
    >
      <form className="add-package__frame" onSubmit={(event) => void save(event)}>
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">
            {text.identity}
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="add-package__body">
          <p className="add-package__note">{text.identityLead}</p>
          <IdentityFields form={form} id="identity-dialog" />
        </div>
        {form.failure !== null && (
          <p role="alert" className="notice notice--error add-package__failure">
            {say(form.failure)}
          </p>
        )}
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          <button type="button" className="button" disabled={form.sending} onClick={onClose}>
            {t.common.cancel}
          </button>
          <button type="submit" className="button button--primary" disabled={!form.ready}>
            {text.save}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  )
}
