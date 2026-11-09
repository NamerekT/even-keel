import { Link, useNavigate } from 'react-router'
import type { PackagesView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { problemCount, problemsOf } from '../tools/matrix.js'
import { packagesPath } from '../tools/packageGroups.js'
import { choiceTip, trackerDoubled, trackerPackage } from '../tools/packageView.js'
import { useToolsViews } from '../tools/useToolsViews.js'
import { Tipped } from '../ui/Tipped.js'
import '../tools/tools.css'

/**
 * The project's "What sessions get" in its head: problems of its settings, and the tracker's package it lacks — a problem
 * with `brief` off, advice otherwise — and a warning while it gets both the tracker's own server and the tasks server. Amber with the count while there are problems, quiet with only the advice, gone when
 * everything reaches the sessions; the details are its tip, a press goes where they are fixed: the settings problems to
 * /tools, the tracker's package to the project's packages.
 */
export function ToolsChip({ project, trim, packages }: { project: string; trim: boolean; packages: PackagesView }) {
  const loaded = useToolsViews([project], trim).get(project)
  const tracker = trackerPackage(packages, project)
  const missing = tracker?.state === 'missing' ? tracker : null
  const doubled = trackerDoubled(packages, project)
  const settings = loaded?.state === 'ready' && loaded.view !== null ? problemCount(problemsOf(loaded.view)) : null
  const count = settings === null ? null : settings + (missing?.problem === true ? 1 : 0)
  const warn = (count !== null && count > 0) || missing?.problem === true
  if (!warn && missing === null && doubled === null) return null

  const tip = (
    <>
      {t.tools.link(count)}
      {missing !== null && (
        <>
          <br />
          {missing.problem ? t.tools.trackerProblem(missing.server) : t.tools.trackerAdvice(missing.choices.map((each) => each.server))}
        </>
      )}
      {doubled !== null && (
        <>
          <br />
          {t.tools.trackerDoubled(doubled.server, doubled.also)}
        </>
      )}
    </>
  )
  const to = missing !== null ? packagesPath(project, missing.choices[0]?.plugin ?? null) : doubled !== null ? packagesPath(project) : `/tools?projects=${encodeURIComponent(project)}`
  return (
    <Tipped className="tools-chip" tip={tip} inline>
      <Link className={warn ? 'chip chip--link chip--tools chip--tools-warn' : 'chip chip--link chip--tools'} to={to}>
        {t.tools.heading}
        {warn && count !== null && count > 0 && <span className="chip__count">{count}</span>}
      </Link>
    </Tipped>
  )
}

/** Next to "Task description in the prompt": to the tracker's package in the project's packages while the project lacks it, inactive once a package brings it. */
export function TrackerPackageButton({ project, packages }: { project: string; packages: PackagesView }) {
  const navigate = useNavigate()
  const tracker = trackerPackage(packages, project)
  if (tracker === null) return null
  const missing = tracker.state === 'missing'
  const first = tracker.state === 'missing' ? (tracker.choices[0] ?? null) : null
  const advice = first === null ? t.settings.briefToolsTurnOn(null) : `${first.plugin !== null ? t.settings.briefToolsAdd(first.plugin) : t.settings.briefToolsTurnOn(first.name)} ${choiceTip(first)}`
  const tip = tracker.state === 'brought' ? t.settings.briefToolsBrought(tracker.by ?? tracker.server) : advice

  return (
    <Tipped tip={tip} inline>
      <button type="button" className="button" aria-disabled={!missing} onClick={() => missing && navigate(packagesPath(project, first?.plugin ?? null))}>
        {t.settings.briefTools}
      </button>
    </Tipped>
  )
}
