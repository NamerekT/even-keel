import type { InviteView } from '../../../src/access/view.js'

export type InviteStage = 'waiting' | 'opened' | 'expired' | 'over'

export interface StageFacts {
  /** Milliseconds the link has left by the page clock. */
  left: number
  /** The invitation as the service lists it now; `undefined` — not listed (yet, or any more). */
  invite: InviteView | undefined
  /** The list has held it once: missing from it now means it ended. */
  seen: boolean
  /** The hub refused a decision on it with `auth.inviteGone`. */
  gone: boolean
}

/**
 * What the invitation dialog shows (BTN-1665): at zero the link is dead, opened or not, since the hub lets nobody in after
 * it; before zero an invitation the list dropped or the hub called gone was decided elsewhere or cancelled.
 */
export function inviteStage({ left, invite, seen, gone }: StageFacts): InviteStage {
  if (left <= 0) return 'expired'
  if (gone || (invite === undefined && seen)) return 'over'
  return invite?.opened == null ? 'waiting' : 'opened'
}

/** The invitations still alive by the page clock: the service drops an expired one only on its next read. */
export function liveInvites(invites: readonly InviteView[], now: number): InviteView[] {
  return invites.filter((each) => Date.parse(each.expiresAt) > now)
}
