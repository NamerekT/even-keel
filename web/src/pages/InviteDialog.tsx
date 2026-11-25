import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { InviteMade, InviteView, KnownOrigin } from '../../../src/access/view.js'
import { noticeOf } from '../../../src/notice/notice.js'
import { formatClock, formatFullTime, formatStamp } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { Field } from '../tools/AddPackage.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { Band, CommandBlock } from '../ui/blocks.js'
import { QrCode } from '../ui/Qr.js'
import { Select } from '../ui/Select.js'
import { Tipped } from '../ui/Tipped.js'
import { linkPlaceOf, withTyped } from './inviteOrigin.js'
import { inviteStage } from './inviteStage.js'
import '../tools/addPackage.css'
import './inviteDialog.css'

export { loopbackName } from './inviteOrigin.js'

/** The guide's section on a proxy and Tailscale: how the page opens from another device. */
export const REACH_GUIDE = 'https://github.com/NamerekT/even-keel/blob/main/docs/guide/remote.md#reaching-the-page-from-another-machine'

/** The answer of `invites/origin`: the address as the hub read it, and every address it knows now. */
export interface TypedOrigin {
  origin: string
  origins: KnownOrigin[]
}

/** The link of an invitation: the secret in the fragment, so loading the page never sends it to the server or a proxy. */
export function inviteLink(origin: string, secret: string): string {
  return `${origin}/invite#${secret}`
}

interface InviteDialogProps {
  made: InviteMade
  /** The invitation as the service lists it now; `undefined` — not listed (yet, or any more). */
  invite: InviteView | undefined
  /** The hub refused a decision on it as `auth.inviteGone`: the list may still hold it until the next read. */
  gone: boolean
  busy: boolean
  failure: string | null
  onAdmit: () => void
  onDecline: () => void
  onCancel: () => void
  /** A new link in place of an expired one. */
  onAgain: () => void
  /** Keeps an address typed on a page opened by `localhost` (BTN-1661); a refusal is thrown. */
  onOrigin: (typed: string) => Promise<TypedOrigin>
  /** Closing keeps the invitation: it stays a row in "Devices". */
  onClose: () => void
}

/**
 * The invitation of a new device (BTN-1655, `docs/web/sign-in.md`, "Invitations"): the QR and the link while nobody
 * opened it, then who opened it and the two digits to compare before "Let in". On a page opened by `localhost` the link
 * goes to an outside address of the hub, picked when there are several, typed when there is none (BTN-1661).
 */
export function InviteDialog({ made, invite, gone, busy, failure, onAdmit, onDecline, onCancel, onAgain, onOrigin, onClose }: InviteDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const now = useNow(1000)
  const [seen, setSeen] = useState(false)
  const [typedKnown, setTypedKnown] = useState<KnownOrigin[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [other, setOther] = useState(false)
  const [typed, setTyped] = useState('')
  const [typedError, setTypedError] = useState<string | null>(null)
  const [keeping, setKeeping] = useState(false)
  const place = linkPlaceOf(location, withTyped(made.origins, typedKnown))
  const origin = place.kind === 'page' ? place.origin : place.kind === 'known' ? (chosen !== null && place.origins.includes(chosen) ? chosen : place.origins[0]!) : null
  const link = origin === null ? null : inviteLink(origin, made.secret)
  const left = Date.parse(made.expiresAt) - now.getTime()

  const keep = async (event: FormEvent) => {
    event.preventDefault()
    setTypedError(null)
    setKeeping(true)
    try {
      const answer = await onOrigin(typed)
      setTypedKnown(answer.origins)
      setChosen(answer.origin)
      setOther(false)
      setTyped('')
    } catch (error) {
      setTypedError(say(noticeOf(error)))
    } finally {
      setKeeping(false)
    }
  }

  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (dialog.current?.open !== false) return
    // The dialog focuses Close, not the link's copy button that comes first: its tip would open over what follows the
    // link. React's `autoFocus` sets no attribute, and the dialog looks only at the attribute.
    close.current?.setAttribute('autofocus', '')
    dialog.current.showModal()
  }, [])
  useEffect(() => {
    if (invite !== undefined) setSeen(true)
  }, [invite])

  const stage = inviteStage({ left, invite, seen, gone })
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
              {place.kind === 'ask' && (
                <Band
                  tone="note"
                  action={
                    <a className="button button--small" href={REACH_GUIDE} target="_blank" rel="noreferrer">
                      {t.signIn.inviteAskGuide}
                    </a>
                  }
                >
                  {t.signIn.inviteAsk}
                </Band>
              )}
              {place.kind === 'known' && origin !== null && place.origins.length > 1 && (
                <Field label={t.signIn.inviteAddress} hint={t.signIn.inviteAddressTip}>
                  {(id) => <Select id={id} className="add-package__input" value={origin} options={place.origins.map((each) => ({ value: each, label: each }))} onChange={setChosen} />}
                </Field>
              )}
              {link !== null && (
                <>
                  <QrCode className="invite__qr" text={link} label={t.signIn.inviteQr} />
                  <CommandBlock className="invite__link" command={link} copyLabel={t.signIn.inviteCopy} />
                </>
              )}
              {place.kind === 'known' && !other && (
                <button type="button" className="button button--small invite__other" onClick={() => setOther(true)}>
                  {t.signIn.inviteOtherAddress}
                </button>
              )}
              {(place.kind === 'ask' || other) && (
                <form className="invite__ask" onSubmit={(event) => void keep(event)}>
                  <Field label={t.signIn.inviteAskField} hint={t.signIn.inviteAskFieldTip} error={typedError ?? undefined}>
                    {(id) => (
                      <input
                        id={id}
                        className="add-package__input add-package__input--mono"
                        type="text"
                        inputMode="url"
                        autoComplete="url"
                        spellCheck={false}
                        placeholder={t.signIn.inviteAskPlaceholder}
                        value={typed}
                        aria-invalid={typedError !== null}
                        onChange={(event) => {
                          setTyped(event.target.value)
                          setTypedError(null)
                        }}
                      />
                    )}
                  </Field>
                  <button type="submit" className={place.kind === 'ask' ? 'button button--primary' : 'button'} disabled={keeping || typed.trim() === ''}>
                    {t.signIn.inviteAskShow}
                  </button>
                </form>
              )}
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
