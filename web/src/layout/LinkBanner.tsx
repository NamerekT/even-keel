import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'

export function LinkBanner() {
  const { state, link, retryNow } = useLive()
  if (link !== 'stale' || state === null) return null

  return (
    <div className="banner" role="alert">
      <div className="banner__inner">
        <span>{t.banner.stale}</span>
        <button type="button" className="button" onClick={retryNow}>
          {t.common.retry}
        </button>
      </div>
    </div>
  )
}
