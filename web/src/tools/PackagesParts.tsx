import { useState, type FormEvent, type ReactNode } from 'react'
import type { KeyView, PackageProblem, PackagesView, PackageView } from '../../../src/state.js'
import { formatAgo } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { HelpTip } from '../pages/settingsParts.js'
import { Band } from '../ui/blocks.js'
import { FoldBody, FoldToggle } from '../ui/Fold.js'
import { useProjectLabel } from '../ui/ProjectLabel.js'
import { secretInput } from '../ui/secret.js'
import { Tipped } from '../ui/Tipped.js'
import { shortName, type PackageGroup, type PackageIssue } from './packageGroups.js'
import { importOffers, keyLabel, passes, problemText, type Dismissed } from './packageView.js'
import './packages.css'

const DISMISSED_KEY = 'even-keel.packages.imports'

function readDismissed(): Dismissed {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}')
    return typeof raw === 'object' && raw !== null ? (raw as Dismissed) : {}
  } catch {
    return {}
  }
}

/** The servers of a repository's committed `.mcp.json` the catalog does not have; a dismissal holds until the list changes. */
export function ImportOffers({ view, projects }: { view: PackagesView; projects: string[] }) {
  const { send, sending, failure } = useCommand()
  const [dismissed, setDismissed] = useState(readDismissed)
  const label = useProjectLabel()
  const offers = importOffers(view, projects, dismissed)
  if (offers.length === 0) return null

  const dismiss = (project: string, servers: string[]) => {
    const next = { ...dismissed, [project]: servers.join(',') }
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    setDismissed(next)
  }

  return (
    <div className="packages__offers">
      {offers.map(({ project, servers }) => (
        <Band
          key={project}
          tone="warn"
          action={
            <>
              <button type="button" className="button button--small button--primary" disabled={sending} onClick={() => void send('packages/import', { project })}>
                {t.packages.importAdd}
              </button>
              <button type="button" className="button button--small" onClick={() => dismiss(project, servers)}>
                {t.packages.importDismiss}
              </button>
            </>
          }
        >
          {t.packages.import(label(project), servers.join(', '))} <HelpTip text={t.packages.importTip} />
        </Band>
      ))}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </div>
  )
}

/** The id of a package's row, for a problem's link to it. */
export const rowId = (scope: string, name: string) => `package-${scope}-${name.replace(/\W/g, '-')}`

/** Each problem a line of its own, with the way to its package's row (`go`) or what else fixes it (`action`). */
export function IssueBands({ issues, go, action }: { issues: PackageIssue[]; go: (name: string) => void; action?: (issue: PackageIssue) => ReactNode }) {
  if (issues.length === 0) return null
  return (
    <div className="packages__issues">
      {issues.map((issue) => (
        <Band
          key={`${issue.name ?? ''}:${JSON.stringify(issue.problem)}`}
          tone={passes(issue.problem) ? 'note' : 'error'}
          action={
            action?.(issue) ??
            (issue.name !== null && (
              <button type="button" className="button button--small" onClick={() => go(issue.name!)}>
                {t.packages.toRow}
              </button>
            ))
          }
        >
          {issue.name !== null && <code className="packages__issue-name">{issue.name}</code>}
          <Tipped tip={problemTip(issue.problem)} focusable inline>
            {problemText(issue.problem)}
          </Tipped>
        </Band>
      ))}
    </div>
  )
}

export function problemTip(problem: PackageProblem): string {
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

/** A group of packages by source: its name and count (`count` — with those folded), the name of the column of switches, the rows split by lines. */
export function GroupBox({ group, count = group.packages.length, column, children, foot }: { group: PackageGroup; count?: number; column: string; children: ReactNode; foot?: ReactNode }) {
  const title = group.kind === 'own' ? t.packages.group.own : group.kind === 'mcp' ? t.packages.group.mcp : group.marketplace
  return (
    <section className="packages__group" aria-label={title ?? undefined}>
      <header className="packages__group-head">
        <span className="packages__group-title">{title}</span>
        {group.kind !== 'mcp' && group.kind !== 'own' && <span className="packages__group-note">{t.packages.kind.plugin}</span>}
        <span className="packages__group-count">{count}</span>
        <span className="packages__group-column">{column}</span>
      </header>
      <ul className="packages__rows">{children}</ul>
      {foot}
    </section>
  )
}

interface LineProps {
  pkg: PackageView
  /** The id the problems link to. */
  id: string
  open: boolean
  onToggle: () => void
  /** A problem holds the chain on it. */
  alert?: boolean
  /** What stands at the row's right: a switch, a button. */
  aside: ReactNode
  /** Its details, folded under it. */
  children: () => ReactNode
}

/** One package on one line: its name never pushes the controls onto a second one. */
export function PackageLine({ pkg, id, open, onToggle, alert = false, aside, children }: LineProps) {
  return (
    <li id={id} className={pkg.removed ? 'packages__line packages__line--removed' : 'packages__line'}>
      <div className="packages__line-main">
        <FoldToggle className="packages__name" aria-controls={`${id}-details`} aria-expanded={open} aria-label={t.packages.details(pkg.name)} onClick={onToggle}>
          {alert && <span className="lamp lamp--error" role="img" aria-label={t.packages.problemsLabel} />}
          <code className="packages__name-text">{shortName(pkg)}</code>
        </FoldToggle>
        <PackageMeta pkg={pkg} />
        <span className="packages__aside">{aside}</span>
      </div>
      <FoldBody id={`${id}-details`} open={open}>
        {() => <div className="packages__details">{children()}</div>}
      </FoldBody>
    </li>
  )
}

/** The version, a newer one, an install under way: a muted strip after the name. */
function PackageMeta({ pkg }: { pkg: PackageView }) {
  const version = pkg.version ?? (pkg.installed || pkg.installing ? null : t.packages.notInstalled)
  return (
    <span className="packages__meta">
      {version !== null && <span className="packages__version">{version}</span>}
      {pkg.latest !== null && !pkg.installing && (
        <Tipped className="packages__latest" tip={t.packages.latestTip(pkg.latest, pkg.fetched === null ? null : formatAgo(pkg.fetched, new Date()))} focusable inline>
          → {pkg.latest}
        </Tipped>
      )}
      {pkg.installing && <span className="packages__busy">{t.packages.installing}</span>}
      {pkg.removed && <span className="packages__version">{t.packages.removed}</span>}
    </span>
  )
}

/** In place of a built-in package's switches (BTN-986): every project has it. */
export function BuiltInTag() {
  return (
    <Tipped className="tag" tip={t.packages.builtInTip} focusable inline>
      {t.packages.builtIn}
    </Tipped>
  )
}

/** What a package brings, the first line of its details. */
export function PackageBrings({ pkg }: { pkg: PackageView }) {
  return (
    <p className="packages__brings">
      <span>{pkg.servers.length === 0 ? t.packages.noServers : t.packages.servers(pkg.servers.join(', '))}</span>
      {pkg.extras && (
        <Tipped className="tag packages__extras" tip={t.packages.extrasTip} focusable inline>
          {t.packages.extras}
        </Tipped>
      )}
    </p>
  )
}

/** A package's settings, a field per key; `project` — the project's own values over `base`. */
export function PackageSettings({ pkg, project, values }: { pkg: PackageView; project?: string; values?: Record<string, string> }) {
  const keys = Object.keys(pkg.settings)
  if (keys.length === 0) return <p className="packages__quiet">{t.packages.noSettings}</p>
  return (
    <div className="packages__fields">
      <span className="packages__label">
        {project === undefined ? t.packages.settingsBase : t.packages.settingsProject}
        <HelpTip text={t.packages.settingsHint} />
      </span>
      {keys.map((key) => {
        const own = values?.[key]
        const value = project === undefined ? (pkg.settings[key] ?? '') : own === undefined || own === pkg.settings[key] ? '' : own
        return <SettingField key={key} name={pkg.name} settingKey={key} project={project} value={value} placeholder={project === undefined ? '' : (pkg.settings[key] ?? '')} />
      })}
    </div>
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
    <form className="packages__field" onSubmit={commit}>
      <label className="packages__field-name">
        <code>{settingKey}</code>
        <input
          className="packages__input"
          value={draft}
          placeholder={placeholder}
          disabled={sending}
          aria-invalid={failure !== null}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit()}
        />
      </label>
      {failure !== null && <span className="packages__error">{say(failure)}</span>}
    </form>
  )
}

/** Keys, a field each: the page sees only whether one is set. `titled` — under their own label, inside a package's details. */
export function KeyList({ keys, titled = true }: { keys: KeyView[]; titled?: boolean }) {
  if (keys.length === 0) return null
  return (
    <div className="packages__fields">
      {titled && (
        <span className="packages__label">
          {t.packages.keys}
          <HelpTip text={t.packages.keysTip} />
        </span>
      )}
      {keys.map((key) => (
        <KeyRow key={key.name} entry={key} />
      ))}
    </div>
  )
}

function KeyRow({ entry }: { entry: KeyView }) {
  const { send, sending, failure } = useCommand()
  const [value, setValue] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await send('packages/key', { name: entry.name, value })) setValue('')
  }
  const readers = entry.packages.length === 0 ? t.packages.keyTracker : entry.packages.join(', ')
  const label = keyLabel(entry.name, t.secrets.purpose)

  return (
    <form className="packages__field" onSubmit={(event) => void submit(event)}>
      <span className="packages__field-name">
        <Tipped className="packages__key-name" tip={t.packages.keyReads(entry.name, readers)} focusable inline>
          {label}
        </Tipped>
        {!entry.set && <span className="chip packages__unset">{t.packages.keyUnset}</span>}
      </span>
      <span className="packages__key-form">
        <input
          className="packages__input"
          {...secretInput()}
          value={value}
          placeholder={entry.set ? t.packages.keySaved : undefined}
          aria-label={t.packages.keyValue(label)}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" className="button button--small" disabled={sending || value === ''}>
          {t.packages.keySave}
        </button>
      </span>
      {failure !== null && <span className="packages__error">{say(failure)}</span>}
    </form>
  )
}
