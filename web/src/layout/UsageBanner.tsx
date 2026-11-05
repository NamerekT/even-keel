import { Fragment } from 'react'
import type { EvenKeelState } from '../../../src/state.js'
import { useLive } from '../live/context.js'
import { Tipped } from '../ui/Tipped.js'
import { usageGroups, usageNotices, type AccountUsageNotice, type UsageGroup } from './usageNotices.js'
import { Banner } from './Banner.js'
import { kindShown, noticeId, notDismissed, NoticeButtons } from './NoticeButtons.js'

/**
 * Accounts whose limits are unread: one banner for the accounts alike, each named with its own detail. "Got it"
 * hides an account until its notice changes, on every device; "Don't show again" turns the warnings off (BTN-759).
 */
export function UsageBanner() {
  const { state } = useLive()
  return usageGroups(usageShown(state)).map((group) => <UsageGroupBanner key={group.notices[0]!.account} group={group} />)
}

function usageShown(state: EvenKeelState | null): AccountUsageNotice[] {
  if (state === null) return []
  const kind = kindShown(state, 'usage.unread')
  return usageNotices(state.account).filter((notice) => (kind || notice.tone === 'error') && notDismissed(state, markOf(notice), notice.key))
}

function UsageGroupBanner({ group }: { group: UsageGroup }) {
  return (
    <Banner tone={group.tone}>
      <div className="banner__inner">
        <span>
          {group.notices.map((notice, index) => (
            <Fragment key={notice.account}>
              {index > 0 && ', '}
              <Tipped inline focusable tip={notice.detail}>
                {notice.name}
              </Tipped>
            </Fragment>
          ))}
          {`: ${group.reason}`}
        </span>
        <span className="banner__actions">
          <NoticeButtons
            stamps={Object.fromEntries(group.notices.map((notice) => [markOf(notice), notice.key]))}
            kind={group.tone === 'error' ? undefined : 'usage.unread'}
          />
        </span>
      </div>
    </Banner>
  )
}

const markOf = (notice: AccountUsageNotice): string => noticeId(`usage:${notice.account}`)
