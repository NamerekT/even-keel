import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { FixButton } from '../pages/FixButtons.js'
import { configFixOf } from '../pages/noticeFix.js'

export function ConfigBanner() {
  const { state } = useLive()
  if (state === null || state.configError === null) return null
  const fix = configFixOf(state)

  return (
    <div className="banner banner--error" role="alert">
      <div className="banner__inner">
        <span>{t.banner.config(say(state.configError))}</span>
        {fix !== null && <FixButton project={null} fix={fix} className="button button--small" />}
      </div>
    </div>
  )
}
