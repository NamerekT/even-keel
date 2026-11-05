import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { FixButton } from '../pages/FixButtons.js'
import { configFixOf } from '../pages/noticeFix.js'
import { Banner } from './Banner.js'
import { noticeId, notDismissed, NoticeButtons } from './NoticeButtons.js'

const MARK = noticeId('config')

/** A broken config holds every chain: it is no kind and takes only "Got it", back when the error changes (BTN-759). */
export function ConfigBanner() {
  const { state } = useLive()
  if (state === null || state.configError === null) return <Banner />
  const stamp = JSON.stringify(state.configError)
  if (!notDismissed(state, MARK, stamp)) return <Banner />
  const fix = configFixOf(state)

  return (
    <Banner tone="error">
      <div className="banner__inner">
        <span>{t.banner.config(say(state.configError))}</span>
        <span className="banner__actions">
          {fix !== null && <FixButton project={null} fix={fix} className="button button--small" />}
          <NoticeButtons stamps={{ [MARK]: stamp }} small />
        </span>
      </div>
    </Banner>
  )
}
