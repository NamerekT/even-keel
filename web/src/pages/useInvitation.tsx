import { useState, type ReactNode } from 'react'
import type { InviteMade, InviteView } from '../../../src/access/view.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import { say } from '../i18n/index.js'
import { InviteDialog, type TypedOrigin } from './InviteDialog.js'
import type { AuthPost } from './passkey.js'

export interface Invitation {
  /** The invitation whose dialog is open; `null` — none. */
  made: InviteMade | null
  /** Makes a new invitation and opens its dialog; a refusal is thrown to the caller, the dialog stays closed. */
  start: () => Promise<void>
  /** Closes the dialog; the invitation stays a row in "Devices". */
  close: () => void
  /** The open dialog over `invites` as the service lists them now; `null` — none open. */
  dialog: (invites: readonly InviteView[] | undefined, busy: boolean) => ReactNode
}

/**
 * The invitation dialog's flow (BTN-1655), shared by "Sign-in and devices" and the setup's "Phone access" step (BTN-1638):
 * a decision taken in the dialog closes it, a refusal stays in it. `changed` — the invitations changed, read them anew.
 */
export function useInvitation(post: AuthPost, changed: () => void): Invitation {
  const [made, setMade] = useState<InviteMade | null>(null)
  const [failure, setFailure] = useState<Notice | null>(null)

  const create = async () => {
    setMade(await post<InviteMade>('auth/invites/create', {}))
    changed()
  }
  const decide = async (name: 'admit' | 'decline' | 'cancel') => {
    if (made === null) return
    setFailure(null)
    try {
      await post(`auth/invites/${name}`, { id: made.id })
      setMade(null)
      changed()
    } catch (error) {
      setFailure(noticeOf(error))
    }
  }
  const again = async () => {
    setFailure(null)
    try {
      await create()
    } catch (error) {
      setFailure(noticeOf(error))
    }
  }
  const close = () => {
    setMade(null)
    setFailure(null)
  }

  return {
    made,
    start: create,
    close,
    dialog: (invites, busy) =>
      made === null ? null : (
        <InviteDialog
          made={made}
          invite={invites?.find((each) => each.id === made.id)}
          busy={busy}
          failure={failure === null ? null : say(failure)}
          onAdmit={() => void decide('admit')}
          onDecline={() => void decide('decline')}
          onCancel={() => void decide('cancel')}
          onAgain={() => void again()}
          onOrigin={(typed) => post<TypedOrigin>('auth/invites/origin', { origin: typed })}
          onClose={close}
        />
      ),
  }
}
