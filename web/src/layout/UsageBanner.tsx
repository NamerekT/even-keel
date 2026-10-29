import { useState } from 'react'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Tipped } from '../ui/Tipped.js'
import { usageNotices, type AccountUsageNotice } from './usageNotices.js'
import { Banner } from './Banner.js'

const DISMISSED_KEY = 'even-keel.usageNotice.dismissed'

export function UsageBanner() {
  const { state } = useLive()
  return (state === null ? [] : usageNotices(state.account)).map((notice) => <AccountUsageBanner key={notice.account} notice={notice} />)
}

function AccountUsageBanner({ notice }: { notice: AccountUsageNotice }) {
  const storageKey = `${DISMISSED_KEY}.${notice.account}`
  const [dismissed, setDismissed] = useState(() => readDismissed(storageKey))
  if (notice.key === dismissed) return <Banner />

  const dismiss = () => {
    setDismissed(notice.key)
    try {
      localStorage.setItem(storageKey, notice.key)
    } catch {}
  }

  return (
    <Banner tone={notice.tone}>
      <div className="banner__inner">
        <Tipped inline focusable tip={notice.detail}>{notice.text}</Tipped>
        <button type="button" className="button" onClick={dismiss}>
          {t.common.hide}
        </button>
      </div>
    </Banner>
  )
}

function readDismissed(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
