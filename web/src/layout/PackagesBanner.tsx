import { Link, useLocation } from 'react-router'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { blockedProjects } from '../tools/packageView.js'
import { ProjectLinks } from '../ui/ProjectLinks.js'
import { Banner } from './Banner.js'

/**
 * Chains held by their packages: the gateway does not run, or a set has a problem (`src/packages/check.ts`). A tracker
 * server the sessions lack is not here: the project's chain pauses on `chain.noTrackerMcp` with its own buttons.
 */
export function PackagesBanner() {
  const { state } = useLive()
  const { pathname } = useLocation()
  if (state === null) return <Banner />
  const { gateway } = state.packages
  const blocked = blockedProjects(state.packages, state.projects)
  if (gateway === null && blocked.length === 0) return <Banner />
  const link = pathname === '/tools' ? null : (
    <Link to={`/tools?projects=${blocked.join(',')}`} className="banner__link">
      {t.banner.packagesLink}
    </Link>
  )

  return (
    <Banner tone={gateway === null ? undefined : 'error'}>
      <div className="banner__inner">
        <span>
          {gateway === null ? (
            <ProjectLinks text={t.banner.packages(blocked.join(', '))} />
          ) : (
            t.banner.gateway(say(gateway))
          )}
        </span>
        {link}
      </div>
    </Banner>
  )
}
