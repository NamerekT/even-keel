import { Fragment, useState, type FormEvent } from 'react'
import type { PackageCell, PackageProblem, PackagesView, PackageView } from '../../../src/state.js'
import { formatAgo } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { HelpTip } from '../pages/settingsParts.js'
import { useProjectLabel } from '../ui/ProjectLabel.js'
import { Tipped } from '../ui/Tipped.js'
import { AddPackage } from './AddPackage.js'
import { ImportOffers, Keys, MarketplaceOffer } from './PackagesParts.js'
import { shownPackages } from './packageView.js'
import './packages.css'

/** The catalog against the chosen projects: what each one's sessions get, its problems, and the buttons to change it. */
export function Packages({ view, projects }: { view: PackagesView; projects: string[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const packages = shownPackages(view)

  return (
    <section className="packages">
      <div className="packages__head">
        <h2 className="tools__heading">{t.packages.heading}</h2>
        <HelpTip text={t.packages.hint} />
        <Tipped className="packages__manual" tip={t.packages.manualTip} align="start" focusable inline>
          {t.packages.manual}
        </Tipped>
        <AddPackage view={view} projects={projects} />
      </div>
      {view.gateway !== null && <p className="notice notice--error">{say(view.gateway)}</p>}
      <ImportOffers view={view} projects={projects} />
      <MarketplaceOffer view={view} />
      {packages.length === 0 ? (
        <p className="tools__muted">{t.packages.empty}</p>
      ) : (
        <div className="tools__scroll">
          <table className="tools__matrix packages__table">
            <thead>
              <tr>
                <th />
                {projects.map((project) => (
                  <ProjectHead key={project} project={project} view={view} />
                ))}
              </tr>
            </thead>
            <tbody>
              {packages.map((each) => (
                <Fragment key={each.name}>
                  <PackageRow pkg={each} view={view} projects={projects} open={open === each.name} onToggle={() => setOpen(open === each.name ? null : each.name)} />
                  {open === each.name && <PackageDetails pkg={each} view={view} projects={projects} />}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Keys view={view} />
    </section>
  )
}

function ProjectHead({ project, view }: { project: string; view: PackagesView }) {
  const label = useProjectLabel()
  const found = view.projects[project]
  if (found?.blocked !== true) return <th scope="col">{label(project)}</th>
  const reasons = [
    ...found.problems.map(problemText),
    ...Object.entries(found.cells).flatMap(([name, cell]) => (cell.enabled ? cell.problems.filter((each) => each.kind !== 'unsupported').map((each) => `${name}: ${problemText(each)}`) : [])),
    ...(view.gateway === null ? [] : [say(view.gateway)]),
  ]
  return (
    <th scope="col">
      {label(project)}
      <Tipped className="packages__waits" tip={t.packages.waitsTip(reasons.join('; '))} focusable inline>
        {t.packages.waits}
      </Tipped>
    </th>
  )
}

interface RowProps {
  pkg: PackageView
  view: PackagesView
  projects: string[]
  open: boolean
  onToggle: () => void
}

function PackageRow({ pkg, view, projects, open, onToggle }: RowProps) {
  const { send, sending, failure } = useCommand()
  const meta = [t.packages.kind[pkg.kind], pkg.version ?? (pkg.installed || pkg.installing ? null : t.packages.notInstalled)].filter(Boolean).join(' · ')

  return (
    <tr className={pkg.removed ? 'packages__row packages__row--removed' : 'packages__row'}>
      <th scope="row">
        <button type="button" className="packages__name" aria-expanded={open} aria-label={t.packages.details(pkg.name)} onClick={onToggle}>
          <span className="packages__caret" aria-hidden="true" />
          <code>{pkg.name}</code>
        </button>
        <span className="packages__meta">
          <span className="tools__muted">{meta}</span>
          {pkg.latest !== null && !pkg.installing && (
            <Tipped className="packages__latest" tip={t.packages.latestTip(pkg.latest, pkg.fetched === null ? null : formatAgo(pkg.fetched, new Date()))} focusable inline>
              → {pkg.latest}
            </Tipped>
          )}
          {pkg.extras && (
            <Tipped className="packages__extras" tip={t.packages.extrasTip} focusable inline>
              {t.packages.extras}
            </Tipped>
          )}
          {pkg.installing && <span className="packages__busy">{t.packages.installing}</span>}
          {pkg.removed && <span className="tools__muted">{t.packages.removed}</span>}
        </span>
        {!pkg.removed && !pkg.installing && (
          <span className="packages__actions">
            {!pkg.installed || pkg.error !== null ? (
              <button type="button" className="button button--small" disabled={sending} onClick={() => void send('packages/install', { name: pkg.name })}>
                {t.packages.install}
              </button>
            ) : pkg.latest !== null ? (
              <button
                type="button"
                className="button button--small button--primary"
                aria-label={t.packages.updateTo(pkg.latest)}
                disabled={sending}
                onClick={() => void send('packages/update', { name: pkg.name })}
              >
                {t.packages.update}
              </button>
            ) : (
              <Tipped tip={checkTip(pkg)} inline>
                <button type="button" className="button button--small packages__check" disabled={sending} onClick={() => void send('packages/update', { name: pkg.name })}>
                  {t.packages.check}
                </button>
              </Tipped>
            )}
          </span>
        )}
        {pkg.error !== null && <span className="packages__error">{say(pkg.error)}</span>}
        {pkg.note !== null && <span className="tools__muted packages__note">{say(pkg.note)}</span>}
        {failure !== null && <span className="packages__error">{say(failure)}</span>}
      </th>
      {projects.map((project) => {
        const cell = view.projects[project]?.cells[pkg.name]
        return <td key={project}>{cell === undefined || pkg.removed ? <span className="tools__missing">—</span> : <ChoiceCell pkg={pkg} project={project} cell={cell} />}</td>
      })}
    </tr>
  )
}

function checkTip(pkg: PackageView): string {
  if (pkg.kind === 'mcp') return t.packages.checkTip.mcp
  return pkg.fetched === null ? t.packages.checkTip.folder : t.packages.checkTip.fetched(formatAgo(pkg.fetched, new Date()))
}

function ChoiceCell({ pkg, project, cell }: { pkg: PackageView; project: string; cell: PackageCell }) {
  const { send, sending, failure } = useCommand()
  const label = useProjectLabel()
  const choose = (value: string) => void send('packages/project', { project, name: pkg.name, choice: value === 'default' ? null : value })
  // A server still starting passes in seconds after every service start: a spinner on the select, not a chip.
  const probing = cell.enabled && cell.problems.some((each) => each.kind === 'probing')
  const problems = cell.enabled ? cell.problems.filter((each) => each.kind !== 'probing') : []

  return (
    <span className="packages__cell">
      <span className="packages__select">
        <select
          className={cell.enabled ? 'packages__choice packages__choice--on' : 'packages__choice'}
          value={cell.choice ?? 'default'}
          disabled={sending}
          aria-label={t.packages.choiceLabel(pkg.name, label(project))}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="default">{t.packages.inherited(pkg.default)}</option>
          <option value="on">{t.packages.choice.on}</option>
          <option value="off">{t.packages.choice.off}</option>
        </select>
        {probing && (
          <Tipped className="packages__probing" tip={problemTip({ kind: 'probing' })} focusable inline>
            <span className="packages__spinner" role="img" aria-label={t.packages.problem.probing} />
          </Tipped>
        )}
      </span>
      {problems.length > 0 && (
        <span className="tools__chips">
          {problems.map((problem) => (
            <ProblemChip key={problem.kind} problem={problem} />
          ))}
        </span>
      )}
      {failure !== null && <span className="packages__error">{say(failure)}</span>}
    </span>
  )
}

function ProblemChip({ problem }: { problem: PackageProblem }) {
  return (
    <Tipped className={problem.kind === 'unsupported' ? 'tools__chip tools__chip--plain' : 'tools__chip tools__chip--lost'} tip={problemTip(problem)} focusable inline>
      {problemText(problem)}
    </Tipped>
  )
}

function problemText(problem: PackageProblem): string {
  const text = t.packages.problem
  switch (problem.kind) {
    case 'noKey':
      return text.noKey(problem.variables.join(', '))
    case 'noResponse':
      return text.noResponse(problem.servers.join(', '))
    case 'noTrackerMcp':
      return text.noTrackerMcp(problem.server)
    case 'unsupported':
      return problem.skills === true ? text.noHooks(problem.agent) : text.unsupported(problem.agent)
    default:
      return text[problem.kind]
  }
}

function problemTip(problem: PackageProblem): string {
  const tip = t.packages.problemTip
  switch (problem.kind) {
    case 'installFailed':
      return tip.installFailed(say(problem.notice))
    case 'noTrackerMcp':
      return tip.noTrackerMcp(problem.server)
    case 'unsupported':
      return problem.skills === true ? tip.noHooks(problem.agent) : tip.unsupported(problem.agent)
    default:
      return tip[problem.kind]
  }
}

function PackageDetails({ pkg, view, projects }: { pkg: PackageView; view: PackagesView; projects: string[] }) {
  const { send, sending, failure } = useCommand()
  const label = useProjectLabel()
  const keys = Object.keys(pkg.settings)

  return (
    <tr className="packages__details">
      <td colSpan={projects.length + 1}>
        <div className="packages__panel">
          <p className="tools__muted">{pkg.servers.length === 0 ? t.packages.noServers : t.packages.servers(pkg.servers.join(', '))}</p>
          {!pkg.removed && (
            <label className="tools__toggle">
              <input type="checkbox" checked={pkg.default} disabled={sending} onChange={(event) => void send('packages/default', { name: pkg.name, on: event.target.checked })} />
              {t.packages.byDefault}
            </label>
          )}
          {keys.length === 0 ? (
            <p className="tools__muted">{t.packages.noSettings}</p>
          ) : (
            <div className="packages__settings">
              <span className="packages__settings-title">
                {t.packages.settings}
                <HelpTip text={t.packages.settingsHint} />
              </span>
              <table className="packages__grid">
                <thead>
                  <tr>
                    <th />
                    <th scope="col">{t.packages.settingsBase}</th>
                    {projects.map((project) => (
                      <th key={project} scope="col">
                        {label(project)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key}>
                      <th scope="row">
                        <code>{key}</code>
                      </th>
                      <td>
                        <SettingField name={pkg.name} settingKey={key} value={pkg.settings[key] ?? ''} placeholder="" />
                      </td>
                      {projects.map((project) => {
                        const own = view.projects[project]?.cells[pkg.name]?.settings[key]
                        return (
                          <td key={project}>
                            <SettingField name={pkg.name} settingKey={key} project={project} value={own === undefined || own === pkg.settings[key] ? '' : own} placeholder={pkg.settings[key] ?? ''} />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!pkg.removed && (
            <div>
              <button type="button" className="button button--small button--danger" disabled={sending} onClick={() => void send('packages/remove', { name: pkg.name })}>
                {t.packages.remove}
              </button>
            </div>
          )}
          {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
        </div>
      </td>
    </tr>
  )
}

interface SettingFieldProps {
  name: string
  settingKey: string
  project?: string
  value: string
  placeholder: string
}

/** Sent on Enter or when it loses the focus; an empty field goes back to the value it inherits. */
function SettingField({ name, settingKey, project, value, placeholder }: SettingFieldProps) {
  const { send, sending, failure } = useCommand()
  const label = useProjectLabel()
  const [draft, setDraft] = useState(value)
  const [base, setBase] = useState(value)
  if (base !== value) {
    setBase(value)
    setDraft(value)
  }
  const commit = (event?: FormEvent) => {
    event?.preventDefault()
    if (draft === value) return
    void send('packages/setting', { name, key: settingKey, value: draft.trim() === '' ? null : draft, project })
  }

  return (
    <form onSubmit={commit}>
      <input
        className="packages__input"
        value={draft}
        placeholder={placeholder}
        disabled={sending}
        aria-label={project === undefined ? `${settingKey} — ${t.packages.settingsBase}` : `${settingKey} — ${label(project)}`}
        aria-invalid={failure !== null}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit()}
      />
      {failure !== null && <span className="packages__error">{say(failure)}</span>}
    </form>
  )
}
