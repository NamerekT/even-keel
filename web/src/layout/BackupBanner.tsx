import { say } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { FixButton } from '../pages/FixButtons.js'
import { noticeFixOf } from '../pages/noticeFix.js'
import { Banner } from './Banner.js'
import { noticeId, notDismissed, NoticeButtons } from './NoticeButtons.js'

const MARK = noticeId('backup')

/**
 * The automatic copy of the state database failed (BTN-1083): the older copies stay and Even Keel tries again in an
 * hour. The fix opens Backups; "Got it" hides it until the failure changes.
 */
export function BackupBanner() {
  const { state } = useLive()
  const failure = state?.backup?.failure ?? null
  if (state === null || failure === null) return <Banner />
  const stamp = JSON.stringify(failure)
  if (!notDismissed(state, MARK, stamp)) return <Banner />
  const fix = noticeFixOf(failure)
  return (
    <Banner tone="error">
      <div className="banner__inner">
        <span>{say(failure)}</span>
        <span className="banner__actions">
          {fix !== null && <FixButton project={null} fix={fix} className="button button--small" />}
          <NoticeButtons stamps={{ [MARK]: stamp }} small />
        </span>
      </div>
    </Banner>
  )
}
