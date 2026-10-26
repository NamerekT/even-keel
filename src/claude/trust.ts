import { NoticeError, fail } from '../notice/notice.js'

/** What `claude --bg` prints when the folder's trust dialog was never accepted: it refuses to start, no session is made. */
const UNTRUSTED = /workspace not trusted/i

/**
 * The CLI's refusal of a folder Claude Code does not trust, as a notice that says what to do (BTN-429), or `null` for
 * any other failure. `folder` is the project's checkout: its trust covers the task worktrees inside it.
 */
export function untrustedStart(error: unknown, place: { task: string; folder: string; platform: string; user: string }): NoticeError | null {
  if (!(error instanceof NoticeError) || error.notice.code !== 'claude.startFailed' || !UNTRUSTED.test(error.notice.detail ?? '')) return null
  return fail('claude.untrusted', place, {}, { cause: error })
}
