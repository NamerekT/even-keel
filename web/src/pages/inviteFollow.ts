import type { JoinView } from '../../../src/access/view.js'
import { notice, NoticeError, noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { AuthPost } from './passkey.js'

/** The first pause after a lost link; each next one doubles up to `MAX_PAUSE_MS` (30 calls a minute is the hub's limit). */
export const FIRST_PAUSE_MS = 1000
export const MAX_PAUSE_MS = 8000
/** How long the link may stay lost on a page in view before the screen says so and waits for "Try again". */
export const GIVE_UP_MS = 60_000

export type Ask = 'auth/invite/open' | 'auth/invite/wait'

/** What the screen shows: the hub's answer, a lost link it is asking again over, or the end of the asking. */
export type FollowStep = { at: 'view'; view: JoinView } | { at: 'trouble' } | { at: 'failed'; notice: Notice }

export interface FollowDeps {
  link: string
  post: AuthPost
  /** Waits `ms`, or less once the tab comes back into view or the network comes back. */
  pause: (ms: number) => Promise<void>
  visible: () => boolean
  now: () => number
  show: (step: FollowStep) => void
}

/**
 * Opens the invitation or goes on waiting for it (BTN-1663) until the hub says how it ended: the final view, or null when
 * the asking stopped on a refusal of the hub or a link lost for `GIVE_UP_MS`. A lost link is no end: the claim cookie
 * keeps the place and the hub gives the outcome at the next ask, so the same ask goes again after a pause. A page out
 * of view (a phone's screen off) does not count towards giving up.
 */
export async function followInvite(first: Ask, deps: FollowDeps): Promise<JoinView | null> {
  let ask = first
  let pauseMs = FIRST_PAUSE_MS
  let lostSince: number | null = null
  for (;;) {
    let view: JoinView
    try {
      view = await deps.post<JoinView>(ask, ask === 'auth/invite/open' ? { link: deps.link } : {})
      if (typeof view?.state !== 'string') throw new TypeError('no view in the answer')
    } catch (error) {
      if (!lostLink(error)) {
        deps.show({ at: 'failed', notice: noticeOf(error) })
        return null
      }
      if (!deps.visible()) lostSince = null
      else if (lostSince === null) lostSince = deps.now()
      else if (deps.now() - lostSince >= GIVE_UP_MS) {
        deps.show({ at: 'failed', notice: notice('auth.inviteNoAnswer', {}) })
        return null
      }
      deps.show({ at: 'trouble' })
      await deps.pause(pauseMs)
      pauseMs = Math.min(pauseMs * 2, MAX_PAUSE_MS)
      continue
    }
    pauseMs = FIRST_PAUSE_MS
    lostSince = null
    deps.show({ at: 'view', view })
    if (view.state !== 'waiting') return view
    ask = 'auth/invite/wait'
  }
}

/** No answer of the hub: the fetch failed, or a proxy answered with no notice of ours (a 502 while the hub restarts). */
function lostLink(error: unknown): boolean {
  return !(error instanceof NoticeError) || error.notice.code === 'text'
}

/** `FollowDeps.pause` of a browser: a timer cut short by the tab coming into view or the network coming back. */
export function pauseOrWake(ms: number, target: { window: Window; document: Document } = { window, document }): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      target.document.removeEventListener('visibilitychange', shown)
      target.window.removeEventListener('online', done)
      resolve()
    }
    const shown = () => {
      if (target.document.visibilityState === 'visible') done()
    }
    const timer = setTimeout(done, ms)
    target.document.addEventListener('visibilitychange', shown)
    target.window.addEventListener('online', done)
  })
}
