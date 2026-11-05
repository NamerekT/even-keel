import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Banner } from './Banner.js'
import { noticeId, notDismissed, NoticeButtons } from './NoticeButtons.js'

const MARK = noticeId('gateway')

/**
 * The MCP gateway does not run, which holds every chain. A project's own packages are its own block's: a wait there,
 * or a pause on `chain.packagesNotReady` or `chain.noTrackerMcp` (BTN-656, BTN-657). An error: only "Got it", back
 * when the error changes (BTN-759).
 */
export function PackagesBanner() {
  const { state } = useLive()
  if (state === null || state.packages.gateway === null) return <Banner />
  const stamp = JSON.stringify(state.packages.gateway)
  if (!notDismissed(state, MARK, stamp)) return <Banner />
  return (
    <Banner tone="error">
      <div className="banner__inner">
        <span>{t.banner.gateway(say(state.packages.gateway))}</span>
        <span className="banner__actions">
          <NoticeButtons stamps={{ [MARK]: stamp }} />
        </span>
      </div>
    </Banner>
  )
}
