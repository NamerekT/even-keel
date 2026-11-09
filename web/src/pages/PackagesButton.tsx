import { Link, useLocation } from 'react-router'
import type { PackagesView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { enabledPackages, packagesPath, projectIssues, shortName, type PackageIssue } from '../tools/packageGroups.js'
import { problemText } from '../tools/packageView.js'
import { GoToIcon, PlugIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import './packagesButton.css'

/**
 * The first thing of the settings' Sessions tab (BTN-914): the project's packages over its page, the settings panel kept
 * open under them. It names the packages on, or the first of the project's package problems in amber.
 */
export function PackagesButton({ project, packages }: { project: string; packages: PackagesView }) {
  const location = useLocation()
  const issues = projectIssues(packages, project)
  const names = enabledPackages(packages, project).map(shortName)
  const issueText = (issue: PackageIssue) => {
    const found = issue.name === null ? undefined : packages.packages.find((each) => each.name === issue.name)
    const problem = problemText(issue.problem)
    return found === undefined ? problem : `${shortName(found)}: ${problem}`
  }
  const warn = issues.length > 0
  const line = warn ? issueText(issues[0]!) : names.length === 0 ? t.packages.openNone : names.join(', ')
  const tip = (
    <>
      {t.packages.openTip}
      {warn &&
        issues.map((issue) => (
          <span key={`${issue.name ?? ''}:${JSON.stringify(issue.problem)}`} className="packages-button__tip-line">
            {issueText(issue)}
          </span>
        ))}
      {!warn && names.length > 0 && <span className="packages-button__tip-line">{names.join(', ')}</span>}
    </>
  )

  return (
    <Tipped className="packages-button" tip={tip} inline>
      <Link className={warn ? 'button packages-button__link packages-button__link--warn' : 'button packages-button__link'} to={`${packagesPath(project)}${location.hash}`}>
        <PlugIcon />
        <span className="packages-button__label">{t.packages.open}</span>
        <span className="packages-button__line">{line}</span>
        {issues.length > 1 && <span className="packages-button__more">{t.packages.more(issues.length - 1)}</span>}
        <GoToIcon />
      </Link>
    </Tipped>
  )
}
