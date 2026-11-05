import { NOTICE_KINDS, noticeShown, type NoticeKind } from '../../../src/notice/kinds.js'
import type { EvenKeelState } from '../../../src/state.js'
import { say } from '../i18n/index.js'
import { noticeTexts } from '../i18n/notice-choices.js'
import { useCommand } from '../live/useCommand.js'

/** A banner's "Got it" marks: its ids with the stamps of what it says now (BTN-759). */
export type Stamps = Record<string, string>

/** The id of a banner's mark: a project's banners carry the project's id. */
export const noticeId = (name: string, project?: string) => (project === undefined ? name : `${name}@${project}`)

/** Whether the kind is shown for the project, or at all for a shared kind. */
export function kindShown(state: EvenKeelState | null, kind: NoticeKind, project?: string): boolean {
  if (state === null) return true
  return noticeShown(kind, state.config.shared.notices ?? {}, project === undefined ? {} : (state.config.projects[project]?.notices ?? {}))
}

/** Whether the banner of this id is still open: never closed, or closed while it said something else. */
export const notDismissed = (state: EvenKeelState | null, id: string, stamp: string) => state?.noticesDismissed?.[id] !== stamp

/**
 * "Got it" — the banner is closed until what it says changes; "Don't show again" — for a banner of a kind, that kind
 * is turned off: a project's kind for `project`, a shared one for Even Keel (BTN-759).
 */
export function NoticeButtons({ stamps, kind, project, small = false }: { stamps: Stamps; kind?: NoticeKind; project?: string; small?: boolean }) {
  const { send, sending, failure } = useCommand()
  const texts = noticeTexts()
  const className = small ? 'button button--small' : 'button'
  const own = kind !== undefined && NOTICE_KINDS[kind] === 'project' ? (project ?? null) : null
  return (
    <>
      <button type="button" className={className} disabled={sending} onClick={() => void send('notices/dismiss', { entries: stamps })}>
        {texts.gotIt}
      </button>
      {kind !== undefined && (
        <button type="button" className={className} disabled={sending} onClick={() => void send('notices/mute', { project: own, kind, shown: false })}>
          {texts.mute}
        </button>
      )}
      {failure !== null && <span className="settings__error">{say(failure)}</span>}
    </>
  )
}
