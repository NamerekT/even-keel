import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'

export function ConfigBanner() {
  const { state } = useLive()
  if (state === null || state.configError === null) return null

  return (
    <div className="banner banner--error" role="alert">
      <div className="banner__inner">
        <span>{t.banner.config(state.configError)}</span>
      </div>
    </div>
  )
}
