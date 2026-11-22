import { Fragment } from 'react'
import { Link } from 'react-router'
import { formatMoment } from '../format.js'
import { t } from '../i18n/index.js'
import { machinePath } from '../machineColor.js'
import { ciWaitText, limitsWaitText, limitWaitText } from '../state.js'
import { problemText } from '../tools/packageView.js'
import { ProjectLinks, Said } from '../ui/ProjectLinks.js'
import type { ChainWait, WaitedPackage } from '../waits.js'
import { FixButton, NoticeFixButton } from './FixButtons.js'

/**
 * What a running chain waits for before its next task, a line each, with the button that ends the wait where the page
 * has one (BTN-657). `compact` — on a card: the reasons under a notice stay on the project page.
 */
export function ChainWaits({ project, waits, className, compact = false }: { project: string; waits: ChainWait[]; className: string; compact?: boolean }) {
  return waits.map((wait) => (
    <Fragment key={wait.kind}>
      <p className={className}>
        <WaitLine wait={wait} compact={compact} />
      </p>
      {wait.kind === 'packages' && !wait.passing && <FixButton project={project} fix={{ to: 'packages' }} />}
      {/* The machine's page holds its packages of the project (BTN-1524). */}
      {wait.kind === 'machinePackages' && !wait.passing && <Link className="button button--small notice-fix" to={machinePath(wait.machine)}>{t.fix.machine}</Link>}
      {(wait.kind === 'slot' || wait.kind === 'folder') && <NoticeFixButton project={project} notice={wait.notice} />}
    </Fragment>
  ))
}

const namedPackages = (packages: WaitedPackage[]) => packages.map((each) => `${each.name} — ${each.problems.map(problemText).join(', ')}`).join('; ')

export function WaitLine({ wait, compact }: { wait: ChainWait; compact: boolean }) {
  const now = new Date()
  switch (wait.kind) {
    case 'closing':
      return t.banner.closingHold(wait.task)
    case 'ci':
      return <ProjectLinks text={ciWaitText(wait.wait, now)} />
    case 'limits':
      return limitsWaitText(wait.wait, now)
    case 'limit':
      return limitWaitText(wait.until, now)
    case 'model':
      return t.banner.modelHold(wait.model, wait.until === null ? null : formatMoment(wait.until, now))
    case 'gateway':
      return t.banner.gatewayHold
    case 'packages': {
      const named = namedPackages(wait.packages)
      return wait.passing ? t.banner.packagesHold(named) : t.banner.packagesSilentHold(named)
    }
    case 'machinePackages':
      if (wait.gateway) return t.banner.machineGatewayHold(wait.name)
      return t.banner.machinePackagesHold(wait.name, wait.packages.length === 0 ? null : namedPackages(wait.packages))
    case 'slot':
    case 'folder': {
      // A copy, not a spread: a spread over the `Notice` union is a union too large for the compiler.
      const shown = structuredClone(wait.notice)
      if (compact) shown.items = []
      return <Said notice={shown} />
    }
  }
}
