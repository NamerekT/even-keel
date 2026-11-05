import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Banner } from './Banner.js'
import { kindShown, noticeId, notDismissed, NoticeButtons } from './NoticeButtons.js'

const MARK = noticeId('unattended')
/** The banner always says the same, so "Got it" hides it as long as its text stays (BTN-759). */
const STAMP = 'on'

export function UnattendedBanner() {
  const { state } = useLive()
  if (state === null || !state.unattended || !kindShown(state, 'unattended') || !notDismissed(state, MARK, STAMP)) return <Banner />

  return (
    <Banner role="status">
      <div className="banner__inner">
        <span>{t.banner.unattended}</span>
        <span className="banner__actions">
          <NoticeButtons stamps={{ [MARK]: STAMP }} kind="unattended" />
        </span>
      </div>
    </Banner>
  )
}
