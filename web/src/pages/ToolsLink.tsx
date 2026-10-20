import { Link, useNavigate } from 'react-router'
import type { PackagesView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { problemCount, problemsOf } from '../tools/matrix.js'
import { trackerAddPath, trackerPackage } from '../tools/packageView.js'
import { useToolsViews } from '../tools/useToolsViews.js'
import { Tipped } from '../ui/Tipped.js'
import '../tools/tools.css'

/** The project's "What sessions get": problems of its settings, and the tracker's package it lacks — a problem with `brief` off, advice otherwise. */
export function ToolsLink({ project, trim, packages }: { project: string; trim: boolean; packages: PackagesView }) {
  const loaded = useToolsViews([project], trim).get(project)
  const tracker = trackerPackage(packages, project)
  const missing = tracker?.state === 'missing' ? tracker : null
  const settings = loaded?.state === 'ready' && loaded.view !== null ? problemCount(problemsOf(loaded.view)) : null
  const count = settings === null ? null : settings + (missing?.problem === true ? 1 : 0)
  const warn = (count !== null && count > 0) || missing?.problem === true

  return (
    <p className={warn ? 'tools-link tools-link--warn' : 'tools-link'}>
      <span className="tools-link__text">
        <span>{t.tools.link(count)}</span>
        {missing !== null && (
          <span className={missing.problem ? undefined : 'tools-link__advice'}>
            {missing.problem ? t.tools.trackerProblem(missing.server) : t.tools.trackerAdvice(missing.server)}
          </span>
        )}
      </span>
      <Link to={missing === null ? `/tools?projects=${encodeURIComponent(project)}` : trackerAddPath(project, missing.plugin)}>{t.tools.open}</Link>
    </p>
  )
}

/** Next to "Task description in the prompt": to the tracker's package on /tools while the project lacks it, inactive once a package brings it. */
export function TrackerPackageButton({ project, packages }: { project: string; packages: PackagesView }) {
  const navigate = useNavigate()
  const tracker = trackerPackage(packages, project)
  if (tracker === null) return null
  const missing = tracker.state === 'missing'
  const tip =
    tracker.state === 'brought' ? t.settings.briefToolsBrought(tracker.by ?? tracker.server) : tracker.plugin === null ? t.settings.briefToolsTurnOn : t.settings.briefToolsAdd

  return (
    <Tipped tip={tip} inline>
      <button
        type="button"
        className="button"
        aria-disabled={!missing}
        onClick={() => tracker.state === 'missing' && navigate(trackerAddPath(project, tracker.plugin))}
      >
        {t.settings.briefTools}
      </button>
    </Tipped>
  )
}
