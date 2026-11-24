import { useEffect, useId, useRef, useState } from 'react'
import type { InviteMade, InviteView } from '../../../src/access/view.js'
import { formatClock, formatFullTime, formatStamp } from '../format.js'
import { t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { Band, CommandBlock } from '../ui/blocks.js'
import { QrCode } from '../ui/Qr.js'
import { Tipped } from '../ui/Tipped.js'
import '../tools/addPackage.css'
import './inviteDialog.css'

/** A name that reaches only this machine: a link made on it opens nowhere else. */
export function loopbackName(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || hostname === '::1' || /^127\./.test(hostname)
}

/** The link of an invitation: the secret in the fragment, so loading the page never sends it to the server or a proxy. */
export function inviteLink(origin: string, secret: string): string {
  return `${origin}/invite#${secret}`
}

interface InviteDialogProps {
  made: InviteMade
  /** The invitation as the service lists it now; `undefined` — not listed (yet, or any more). */
  invite: InviteView | undefined
  busy: boolean
  failure: string | null
  onAdmit: () => void
  onDecline: () => void
  onCancel: () => void
  /** A new link in place of an expired one. */
  onAgain: () => void
  /** Closing keeps the invitation: it stays a row in "Devices". */
  onClose: () => void
}

/**
 * The invitation of a new device (BTN-1655, `docs/web/sign-in.md`, "Invitations"): the QR and the link while nobody
 * opened it, then who opened it and the two digits to compare before "Let in".
 */
export function InviteDialog({ made, invite, busy, failure, onAdmit, onDecline, onCancel, onAgain, onClose }: InviteDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const now = useNow(1000)
  const [seen, setSeen] = useState(false)
  const link = inviteLink(location.origin, made.secret)
  const left = Date.parse(made.expiresAt) - now.getTime()

  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (dialog.current?.open !== false) return
    // The dialog focuses Close, not the link's copy button that comes first: its tip would open over the loopback
    // warning. React's `autoFocus` sets no attribute, and the dialog looks only at the attribute.
    close.current?.setAttribute('autofocus', '')
    dialog.current.showModal()
  }, [])
  useEffect(() => {
    if (invite !== undefined) setSeen(true)
  }, [invite])

  // Until the list first holds it, the invitation just made is taken as unopened.
  const stage = left <= 0 && invite?.opened == null ? 'expired' : invite === undefined ? (seen ? 'over' : 'waiting') : invite.opened === null ? 'waiting' : 'opened'
  const opened = invite?.opened ?? null

  return (
    <dialog
      ref={dialog}
      className="add-package add-package--narrow invite"
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
            {t.signIn.inviteTitle}
          </h2>
        </header>
        <div className="add-package__body invite__body">
          {stage === 'waiting' && (
            <>
              <QrCode className="invite__qr" text={link} label={t.signIn.inviteQr} />
              <CommandBlock className="invite__link" command={link} copyLabel={t.signIn.inviteCopy} />
              {loopbackName(location.hostname) && <Band tone="warn">{t.signIn.inviteLocal}</Band>}
              <p className="invite__state" role="status">
                <span>{t.signIn.inviteWaiting}</span>
                <span className="invite__left">{t.signIn.inviteLeft(formatClock(left))}</span>
              </p>
            </>
          )}
          {stage === 'opened' && opened !== null && (
            <>
              <p className="invite__state" role="status">
                <Tipped tip={formatFullTime(opened.at)} inline>
                  <span>{t.signIn.inviteOpened(opened.device, formatStamp(opened.at, now))}</span>
                </Tipped>
                <span className="invite__left">{t.signIn.inviteLeft(formatClock(left))}</span>
              </p>
              <p className="invite__digits" aria-label={opened.digits.split('').join(' ')}>
                {opened.digits}
              </p>
              <p className="invite__check">{t.signIn.inviteDigits}</p>
            </>
          )}
          {stage === 'expired' && <p className="invite__check">{t.signIn.inviteExpired}</p>}
          {stage === 'over' && <p className="invite__check">{t.signIn.inviteOver}</p>}
        </div>
        {failure !== null && (
          <p role="alert" className="notice notice--error add-package__failure">
            {failure}
          </p>
        )}
        <footer className="add-package__foot add-package__foot--wrap">
          {stage === 'waiting' && (
            <button type="button" className="button" disabled={busy} onClick={onCancel}>
              {t.signIn.inviteCancel}
            </button>
          )}
          {stage === 'opened' && (
            <button type="button" className="button" disabled={busy} onClick={onDecline}>
              {t.signIn.inviteDecline}
            </button>
          )}
          <span className="add-package__spacer" />
          <button ref={close} type="button" className="button" onClick={onClose}>
            {t.signIn.inviteClose}
          </button>
          {stage === 'opened' && (
            <button type="button" className="button button--primary" disabled={busy} onClick={onAdmit}>
              {t.signIn.inviteAdmit}
            </button>
          )}
          {stage === 'expired' && (
            <button type="button" className="button button--primary" disabled={busy} onClick={onAgain}>
              {t.signIn.inviteAgain}
            </button>
          )}
        </footer>
      </div>
    </dialog>
  )
}
