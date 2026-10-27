import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Banner } from './Banner.js'

export function UnattendedBanner() {
  const { state } = useLive()
  if (state === null || !state.unattended) return <Banner />

  return (
    <Banner role="status">
      <div className="banner__inner">
        <span>{t.banner.unattended}</span>
      </div>
    </Banner>
  )
}
