import { Link, useNavigate } from 'react-router'
import type { PackagesView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { problemCount, problemsOf } from '../tools/matrix.js'
import { trackerAddPath, trackerPackage } from '../tools/packageView.js'
import { useToolsViews } from '../tools/useToolsViews.js'
import { Tipped } from '../ui/Tipped.js'
import '../tools/tools.css'

/**
 * The project's "What sessions get" in its head: problems of its settings, and the tracker's package it lacks — a problem
 * with `brief` off, advice otherwise. Amber with the count while there are problems, quiet with only the advice, gone when
 * everything reaches the sessions; the details are its tip, a press goes where they are fixed.
 */
export function ToolsChip({ project, trim, packages }: { project: string; trim: boolean; packages: PackagesView }) {
  const loaded = useToolsViews([project], trim).get(project)
  const tracker = trackerPackage(packages, project)
  const missing = tracker?.state === 'missing' ? tracker : null
  const settings = loaded?.state === 'ready' && loaded.view !== null ? problemCount(problemsOf(loaded.view)) : null
  const count = settings === null ? null : settings + (missing?.problem === true ? 1 : 0)
  const warn = (count !== null && count > 0) || missing?.problem === true
  if (!warn && missing === null) return null

  const tip = (
    <>
      {t.tools.link(count)}
      {missing !== null && (
        <>
          <br />
          {missing.problem ? t.tools.trackerProblem(missing.server) : t.tools.trackerAdvice(missing.server)}
        </>
      )}
    </>
  )
  return (
    <Tipped tip={tip} inline>
      <Link
        className={warn ? 'chip chip--link chip--tools chip--tools-warn' : 'chip chip--link chip--tools'}
        to={missing === null ? `/tools?projects=${encodeURIComponent(project)}` : trackerAddPath(project, missing.plugin)}
      >
        {t.tools.heading}
        {warn && count !== null && count > 0 && <span className="chip__count">{count}</span>}
      </Link>
    </Tipped>
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
