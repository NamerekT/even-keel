import { useEffect, useState } from 'react'
import type { DevicesView } from '../../../src/access/view.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Band } from '../ui/blocks.js'
import { CheckIcon } from '../ui/icons.js'
import { loopbackName } from './InviteDialog.js'
import type { AuthPost } from './passkey.js'
import { FieldNote } from './settingsParts.js'
import { useInvitation } from './useInvitation.js'

const REACH_GUIDE = 'https://github.com/NamerekT/even-keel/blob/main/docs/guide/setup.md#reaching-the-page-from-another-machine'

/**
 * The setup's "Phone access" (BTN-1638): the invitation dialog of "Sign-in and devices" right in the setup, so the phone
 * comes in with no owner key from `.env`. Done once a device is let in (`signInOn`); on a page opened by a loopback name
 * the phone could not open the link, so the step says where to open the page instead.
 */
export function PhoneStep({ state }: { state: EvenKeelState }) {
  const { read, query, onDevices } = useLive()
  const [asked, setAsked] = useState(0)
  const [view, setView] = useState<DevicesView | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Notice | null>(null)
  const post: AuthPost = <T,>(name: string, body: object) => query<T>(name, body as Record<string, unknown>)
  const invitation = useInvitation(post, () => setAsked((count) => count + 1))
  const local = loopbackName(location.hostname)
  const done = state.signInOn === true

  useEffect(() => onDevices(() => setAsked((count) => count + 1)), [onDevices])
  useEffect(() => {
    // The invitations' list tells the dialog who opened the link: read only while one is open.
    if (invitation.made === null) return
    let live = true
    read<DevicesView>('auth/devices', {}).then(
      (next) => live && setView(next),
      (error: unknown) => live && setFailure(noticeOf(error)),
    )
    return () => {
      live = false
    }
  }, [asked, invitation.made])

  const invite = async () => {
    setBusy(true)
    setFailure(null)
    try {
      await invitation.start()
    } catch (error) {
      setFailure(noticeOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="setup__lead">{t.setup.phone.lead}</p>
      <ol className="setup-phone__how">
        {t.setup.phone.how.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      {done && (
        <p className="setup-phone__done" role="status">
          <CheckIcon />
          {t.setup.phone.done}
        </p>
      )}
      {local && !done && (
        <Band
          tone="warn"
          action={
            <a className="button button--small" href={REACH_GUIDE} target="_blank" rel="noreferrer">
              {t.setup.phone.guide}
            </a>
          }
        >
          {t.setup.phone.local}
        </Band>
      )}
      {!local && (
        <div className="setup-phone__actions">
          <button type="button" className={done ? 'button' : 'button button--primary'} aria-haspopup="dialog" disabled={busy} onClick={() => void invite()}>
            {done ? t.setup.phone.inviteMore : t.setup.phone.invite}
          </button>
        </div>
      )}
      <FieldNote error={failure} />
      {invitation.dialog(view?.invites, busy)}
    </>
  )
}
