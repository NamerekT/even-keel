import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Banner } from './Banner.js'

export function LinkBanner() {
  const { state, link, retryNow } = useLive()
  if (link !== 'stale' || state === null) return <Banner />

  return (
    <Banner>
      <div className="banner__inner">
        <span>{t.banner.stale}</span>
        <button type="button" className="button" onClick={retryNow}>
          {t.common.retry}
        </button>
      </div>
    </Banner>
  )
}
