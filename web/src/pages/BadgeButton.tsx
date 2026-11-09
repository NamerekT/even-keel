import { Link, useLocation } from 'react-router'
import type { BadgeSettings } from '../../../src/badge/model.js'
import { t } from '../i18n/index.js'
import { projectPath } from '../state.js'
import { FlagIcon, GoToIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import './packagesButton.css'

/** The address parameter that opens a project's README badge dialog over its page (BTN-917). */
export const BADGE_PARAM = 'badge'

/** The Repository tab's line to the README badge dialog: whether the badge is published, and where. */
export function BadgeButton({ project, badge }: { project: string; badge: BadgeSettings | null | undefined }) {
  const location = useLocation()
  const line = badge == null || !badge.on ? t.badge.lineOff : badge.url === '' || badge.slug === '' ? t.badge.lineNoPlace : t.badge.lineOn(`${hostOf(badge.url)}/${badge.slug}`)
  return (
    <Tipped className="packages-button" tip={t.badge.openTip} inline>
      <Link className="button packages-button__link" to={`${projectPath(project)}?${BADGE_PARAM}=1${location.hash}`}>
        <FlagIcon />
        <span className="packages-button__label">{t.badge.open}</span>
        <span className="packages-button__line">{line}</span>
        <GoToIcon />
      </Link>
    </Tipped>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
