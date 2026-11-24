import { say } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { FixButton } from '../pages/FixButtons.js'
import { noticeFixOf } from '../pages/noticeFix.js'
import { Banner } from './Banner.js'
import { noticeId, notDismissed, NoticeButtons } from './NoticeButtons.js'

const MARK = noticeId('memoryMirror')

/**
 * The memory mirror is set (BTN-1649): Even Keel cannot tell whether its repository is private, so the page says it
 * must be. "Got it" hides it until the address changes.
 */
export function MemoryMirrorBanner() {
  const { state } = useLive()
  const warning = state?.memoryMirror ?? null
  if (state === null || warning === null) return <Banner />
  const stamp = JSON.stringify(warning)
  if (!notDismissed(state, MARK, stamp)) return <Banner />
  const fix = noticeFixOf(warning)
  return (
    <Banner role="status">
      <div className="banner__inner">
        <span>{say(warning)}</span>
        <span className="banner__actions">
          {fix !== null && <FixButton project={null} fix={fix} className="button button--small" />}
          <NoticeButtons stamps={{ [MARK]: stamp }} small />
        </span>
      </div>
    </Banner>
  )
}
