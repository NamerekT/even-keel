import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { FixButton } from '../pages/FixButtons.js'
import { configFixOf } from '../pages/noticeFix.js'
import { Banner } from './Banner.js'

export function ConfigBanner() {
  const { state } = useLive()
  if (state === null || state.configError === null) return <Banner />
  const fix = configFixOf(state)

  return (
    <Banner tone="error">
      <div className="banner__inner">
        <span>{t.banner.config(say(state.configError))}</span>
        {fix !== null && <FixButton project={null} fix={fix} className="button button--small" />}
      </div>
    </Banner>
  )
}
