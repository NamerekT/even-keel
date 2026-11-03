import { useEffect, useId, useRef, type ReactNode } from 'react'
import '../tools/addPackage.css'
import { useBackdropClose } from './backdrop.js'

interface ConfirmProps {
  title: string
  question: string
  /** The button that does it, red. */
  confirm: string
  /** The button that leaves things as they are; it holds the focus, so an Enter does nothing harmful. */
  cancel: string
  busy: boolean
  /** Why the service refused, under the question; the dialog stays open so the person can read it and try again. */
  failure?: ReactNode
  /** A harmless action: the confirm button is the primary one, not red. */
  safe?: boolean
  onConfirm: () => void
  onClose: () => void
}

/** A modal "are you sure?" for a destructive action whose place on the page is too narrow to ask in line. */
export function ConfirmDialog({ title, question, confirm, cancel, busy, failure, safe = false, onConfirm, onClose }: ConfirmProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

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
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">
            {title}
          </h2>
        </header>
        <div className="add-package__body">
          <p className="add-package__question">{question}</p>
          {failure !== undefined && <p className="notice notice--error add-package__failure">{failure}</p>}
        </div>
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            {cancel}
          </button>
          <button type="button" className={safe ? 'button button--primary' : 'button button--danger'} disabled={busy} onClick={onConfirm}>
            {confirm}
          </button>
        </footer>
      </div>
    </dialog>
  )
}
