import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'

export function UnattendedBanner() {
  const { state } = useLive()
  if (state === null || !state.unattended) return null

  return (
    <div className="banner" role="status">
      <div className="banner__inner">
        <span>{t.banner.unattended}</span>
      </div>
    </div>
  )
}
