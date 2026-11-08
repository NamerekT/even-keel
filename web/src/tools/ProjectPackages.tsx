import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import type { EvenKeelState, PackageCell, PackagesView, PackageView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { Inherit, Switch } from '../pages/settingsParts.js'
import { projectLabel } from '../state.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { Band, EmptyState } from '../ui/blocks.js'
import { Tipped } from '../ui/Tipped.js'
import { AddPackage, AddPlugin } from './AddPackage.js'
import { PACKAGE_PARAM, projectGroups,projectIssues, type PackageIssue, type ProjectGroup } from './packageGroups.js'
import { GroupBox, IssueBands, PackageBrings, PackageLine, PackageSettings, problemTip, rowId } from './PackagesParts.js'
import { problemText, trackerPackage } from './packageView.js'
import { useRowFocus } from './useRowFocus.js'
import '../pages/settings.css'
import './addPackage.css'

const SCOPE = 'project'

interface Props {
  state: EvenKeelState
  project: string
  /** The plugin the add dialog opens on over the packages, from the address. */
  adding: string | null
  onAdded: () => void
  onClose: () => void
}

/**
 * A project's packages over its page (BTN-802): which packages of the catalog its chain sessions get, each with where the
 * value comes from, and the values of their settings for this project. Every change is sent at once, not through the
 * settings panel's draft.
 */
export function ProjectPackages({ state, project, adding, onAdded, onClose }: Props) {
  const view = state.packages
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const title = useId()
  const [open, setOpen] = useState<string | null>(null)
  const go = useRowFocus(SCOPE, setOpen)
  const label = projectLabel(state, project)
  const groups = projectGroups(view, project)
  const empty = groups.every((group) => group.packages.length === 0 && group.folded.length === 0)
  const issues = projectIssues(view, project)
  const [plugin, setPlugin] = useState<string | null>(null)
  // `add` in the address: a plugin the catalog already has, or one no marketplace offers, only drops it.
  const offered = adding !== null && view.available.some((each) => `${each.plugin}@${each.marketplace}` === adding)
  useEffect(() => {
    if (adding !== null && !offered) onAdded()
  }, [adding, offered, onAdded])

  // The add dialog goes over these only once they are open: opened first, it would end up under them.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
    setShown(true)
  }, [])

  const tracker = trackerPackage(view, project)
  const fix = (issue: PackageIssue) =>
    issue.name === null && issue.problem.kind === 'noTrackerMcp' && tracker?.state === 'missing' && tracker.plugin !== null ? (
      <button type="button" className="button button--small" onClick={() => setPlugin(tracker.plugin)}>
        {t.packages.trackerAdd}
      </button>
    ) : undefined

  return createPortal(
    <dialog
      ref={dialog}
      className="add-package add-package--wide"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      {...backdrop}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={title} className="add-package__title">
            {t.packages.projectTitle(label)}
          </h2>
          <button type="button" className="panel__close" aria-label={t.packages.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="add-package__body packages packages--project">
          <p className="packages__lead">{t.packages.projectHint}</p>
          {view.gateway !== null && <Band tone="error">{say(view.gateway)}</Band>}
          <IssueBands issues={issues} go={go} action={fix} />
          {empty ? (
            <EmptyState action={<AddPackage view={view} project={project} label={t.packages.addToProject} className="button" />}>{t.packages.projectNone}</EmptyState>
          ) : (
            groups.map((group) => (
              <ProjectGroupBox key={`${group.kind}:${group.marketplace ?? ''}`} group={group} view={view} project={project} open={open} setOpen={setOpen} issues={issues} />
            ))
          )}
        </div>
        <footer className="add-package__foot">
          {!empty && <AddPackage view={view} project={project} label={t.packages.addToProject} className="button" />}
          <span className="add-package__spacer" />
          <button type="button" className="button button--primary" onClick={onClose}>
            {t.packages.done}
          </button>
        </footer>
      </div>
      {shown && adding !== null && offered && <AddPlugin view={view} plugin={adding} project={project} onClose={onAdded} />}
      {plugin !== null && <AddPlugin view={view} plugin={plugin} project={project} onClose={() => setPlugin(null)} />}
    </dialog>,
    document.body,
  )
}

interface GroupProps {
  group: ProjectGroup
  view: PackagesView
  project: string
  open: string | null
  setOpen: (name: string | null) => void
  issues: PackageIssue[]
}

/** A group with the other trackers' plugins under "N more", unfolded on a press. */
function ProjectGroupBox({ group, view, project, open, setOpen, issues }: GroupProps) {
  // A group with nothing but folded plugins shows them: a box holding only "N more" says nothing.
  const [pressed, setUnfolded] = useState(false)
  const unfolded = pressed || group.packages.length === 0
  const shown = unfolded ? [...group.packages, ...group.folded] : group.packages
  if (shown.length === 0 && group.folded.length === 0) return null
  const foot =
    !unfolded && group.folded.length > 0 ? (
      <Tipped tip={t.packages.moreTip} inline>
        <button type="button" className="button button--small button--quiet packages__more" onClick={() => setUnfolded(true)}>
          {t.packages.more(group.folded.length)}
        </button>
      </Tipped>
    ) : undefined
  const cells = view.projects[project]?.cells ?? {}

  return (
    <GroupBox group={{ ...group, packages: shown }} count={group.packages.length + group.folded.length} column={t.packages.inProject} foot={foot}>
      {shown.map((pkg) => {
        const cell = cells[pkg.name]
        if (cell === undefined) return null
        return (
          <ProjectLine
            key={pkg.name}
            pkg={pkg}
            cell={cell}
            project={project}
            open={open === pkg.name}
            alert={issues.some((issue) => issue.name === pkg.name)}
            onToggle={() => setOpen(open === pkg.name ? null : pkg.name)}
          />
        )
      })}
    </GroupBox>
  )
}

interface LineProps {
  pkg: PackageView
  cell: PackageCell
  project: string
  open: boolean
  alert: boolean
  onToggle: () => void
}

function ProjectLine({ pkg, cell, project, open, alert, onToggle }: LineProps) {
  const { send, sending, failure } = useCommand()
  const navigate = useNavigate()
  const choose = (choice: 'on' | 'off' | null) => void send('packages/project', { project, name: pkg.name, choice })
  // A server still starting passes in seconds after every service start: a spinner by the switch, not a problem.
  const probing = cell.enabled && cell.problems.some((each) => each.kind === 'probing')
  const problems = cell.enabled ? cell.problems.filter((each) => each.kind !== 'probing') : []
  const aside = (
    <>
      {probing && (
        <Tipped className="packages__probing" tip={problemTip({ kind: 'probing' })} focusable inline>
          <span className="packages__spinner" role="img" aria-label={t.packages.problem.probing} />
        </Tipped>
      )}
      <Inherit own={cell.choice !== null} shared={pkg.default ? t.settings.on : t.settings.off} disabled={sending} onReset={() => choose(null)} />
      <Switch checked={cell.enabled} disabled={sending} label={t.packages.onLabel(pkg.name)} onChange={(on) => choose(on ? 'on' : 'off')} />
    </>
  )

  return (
    <PackageLine pkg={pkg} id={rowId(SCOPE, pkg.name)} open={open} alert={alert} onToggle={onToggle} aside={aside}>
      {() => (
        <>
          <PackageBrings pkg={pkg} />
          {problems.length > 0 && (
            <ul className="packages__problems">
              {problems.map((problem) => (
                <li key={JSON.stringify(problem)}>
                  <Tipped tip={problemTip(problem)} focusable inline>
                    {problemText(problem)}
                  </Tipped>
                </li>
              ))}
            </ul>
          )}
          <PackageSettings pkg={pkg} project={project} values={cell.settings} />
          <div className="packages__details-actions">
            <Tipped tip={t.packages.toCatalogTip} inline>
              <button type="button" className="button button--small" onClick={() => navigate(`/settings?${PACKAGE_PARAM}=${encodeURIComponent(pkg.name)}`)}>
                {t.packages.toCatalog}
              </button>
            </Tipped>
          </div>
          {failure !== null && <p className="packages__error">{say(failure)}</p>}
        </>
      )}
    </PackageLine>
  )
}
