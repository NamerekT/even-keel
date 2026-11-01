import { Fragment } from 'react'
import { t } from '../i18n/index.js'
import { ciWaitText, limitsWaitText, limitWaitText } from '../state.js'
import { problemText } from '../tools/packageView.js'
import { ProjectLinks, Said } from '../ui/ProjectLinks.js'
import type { ChainWait } from '../waits.js'
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
      {wait.kind === 'slot' && <NoticeFixButton project={project} notice={wait.notice} />}
    </Fragment>
  ))
}

function WaitLine({ wait, compact }: { wait: ChainWait; compact: boolean }) {
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
    case 'gateway':
      return t.banner.gatewayHold
    case 'packages': {
      const named = wait.packages.map((each) => `${each.name} — ${each.problems.map(problemText).join(', ')}`).join('; ')
      return wait.passing ? t.banner.packagesHold(named) : t.banner.packagesSilentHold(named)
    }
    case 'slot':
      return <Said notice={compact ? { ...wait.notice, items: [] } : wait.notice} />
  }
}
