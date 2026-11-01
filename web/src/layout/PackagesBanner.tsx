import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Banner } from './Banner.js'

/**
 * The MCP gateway does not run, which holds every chain. A project's own packages are its own block's: a wait there,
 * or a pause on `chain.packagesNotReady` or `chain.noTrackerMcp` (BTN-656, BTN-657).
 */
export function PackagesBanner() {
  const { state } = useLive()
  if (state === null || state.packages.gateway === null) return <Banner />
  return (
    <Banner tone="error">
      <div className="banner__inner">
        <span>{t.banner.gateway(say(state.packages.gateway))}</span>
      </div>
    </Banner>
  )
}
