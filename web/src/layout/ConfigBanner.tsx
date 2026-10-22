import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { FixButton } from '../pages/FixButtons.js'
import { fieldFixOf } from '../pages/noticeFix.js'
import { fieldOf } from '../pages/settingsField.js'

export function ConfigBanner() {
  const { state } = useLive()
  if (state === null || state.configError === null) return null
  const keys = state.config.trackers.flatMap((tracker) => (tracker.projectKey === null ? [] : [tracker.projectKey.key]))
  const at = fieldOf(state.configError, keys)
  const fix = at === null ? null : fieldFixOf(at)

  return (
    <div className="banner banner--error" role="alert">
      <div className="banner__inner">
        <span>{t.banner.config(say(state.configError))}</span>
        {fix !== null && <FixButton project={null} fix={fix} className="button button--small" />}
      </div>
    </div>
  )
}
