import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState, ProjectCheck, ProjectDraft } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { projectPath } from '../state.js'
import { Select } from '../ui/Select.js'
import { AgentReady } from './AgentReady.js'
import {
  draftOfFields,
  EMPTY_FIELDS,
  idPrefix,
  keyOfTyped,
  keyTyped,
  missingOf,
  readyToAdd,
  shapeOf,
  suggestOfRepo,
  switchProfile,
  trustCommand,
  trustCommandAs,
  typedIn,
  type Missing,
  type TrackerShape,
  type WizardFields,
} from './projectWizard.js'
import { FieldHead } from './settingsParts.js'
import { ruleChoicesOf } from './settingsRows.js'
import { providerOptions } from './settingsRun.js'
import { ListTable } from './settingsTable.js'
import { Status } from './TrackerFields.js'
import { TrackerStep } from './WizardTracker.js'
import './accounts.css'
import './settings.css'
import './projectAdd.css'

const CHECK_DELAY_MS = 600
const WIZARD = '/projects/add'

/** The fields typed, kept while the page is left and come back to (BTN-310); a project added clears them. */
let kept: WizardFields | null = null

interface Checked {
  draft: ProjectDraft
  result: ProjectCheck
}

/**
 * Adding a project: the repository, the tracker's profile and project, then the key and the name where the tracker
 * leaves them free, each checked by the service as it is typed; "Add" writes the project once the repository, the entry
 * and the tracker pass, and says what is missing while it cannot.
 */
export function ProjectAddPage({ state }: { state: EvenKeelState }) {
  const { checkProject } = useLive()
  const navigate = useNavigate()
  const { send, sending, failure } = useCommand()
  const [fields, setFields] = useState<WizardFields>(() => kept ?? firstFields(state))
  const [checked, setChecked] = useState<Checked | null>(null)
  const [checkFailure, setCheckFailure] = useState<Notice | null>(null)
  const [checking, setChecking] = useState(false)
  const [round, setRound] = useState(0)
  const [added, setAdded] = useState<{ key: string; before: string[] } | null>(null)
  const [branchOpen, setBranchOpen] = useState(false)
  const [milestonesOpen, setMilestonesOpen] = useState(false)
  const choice = state.config.trackers.find((each) => each.name === fields.tracker)
  const shape = shapeOf(choice)
  const profile = state.profiles.profiles.find((each) => each.id === fields.profile)
  const draft = draftOfFields(fields, profile?.isDefault === true)
  const draftText = JSON.stringify(draft ?? null)
  const fresh = checked !== null && JSON.stringify(checked.draft) === draftText
  const check = fresh ? checked.result : null
  // The folder's lines depend on the folder and the branch only: they hold while another field is checked again.
  const repoCheck =
    checked !== null && draft !== undefined && checked.draft.repo === draft.repo && checked.draft.branch === draft.branch
      ? checked.result
      : null
  const set = (change: Partial<WizardFields>) => setFields((before) => ({ ...before, ...change }))
  const shared = state.config.shared.provider
  const agent = fields.provider || shared

  useEffect(() => {
    kept = fields
  }, [fields])

  useEffect(() => {
    if (draft === undefined || draft.repo === '') return
    let live = true
    const timer = setTimeout(() => {
      setChecking(true)
      checkProject(draft).then(
        (result) => {
          if (!live) return
          setChecked({ draft, result })
          setCheckFailure(null)
        },
        (error: unknown) => live && setCheckFailure(noticeOf(error)),
      ).finally(() => live && setChecking(false))
    }, CHECK_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // The draft's text stands for the draft: a new object of the same fields asks nothing again.
  }, [draftText, round])

  // Back from the terminal where the trust was given: ask again, once per return and not on a timer (the check reaches the tracker too).
  const untrusted = repoCheck?.trusted === false
  useEffect(() => {
    if (!untrusted) return
    const back = () => {
      if (document.visibilityState === 'visible') setRound((count) => count + 1)
    }
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', back)
    return () => {
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', back)
    }
  }, [untrusted])

  // A repository found: its current branch, and what its remotes and its name suggest for the fields still blank.
  const repo = checked?.result.repo
  const root = repo?.root ?? null
  const current = repo?.current ?? null
  const suggested = repo?.suggested ?? null
  useEffect(() => {
    setFields((before) => suggestOfRepo(before, shape, { root, current, suggested }))
  }, [root, current, suggested, shape])

  // A branch the repository lacks opens the field, and it stays open while the branch is typed again.
  const noBranch = repoCheck?.repo.notice?.code === 'wizard.noBranch'
  useEffect(() => {
    if (noBranch) setBranchOpen(true)
  }, [noBranch])

  // A tracker project another project has opens the milestones, and they stay open while they are typed (BTN-306).
  const trackerShared = check?.entry?.code === 'wizard.trackerShared'
  useEffect(() => {
    if (trackerShared) setMilestonesOpen(true)
  }, [trackerShared])

  useEffect(() => {
    if (added === null) return
    // The new project is the one of the key that was not there before: another project may have the key (BTN-271).
    const project = state.projects.find((each) => !added.before.includes(each) && state.projectKeys[each] === added.key)
    if (project !== undefined) void navigate(projectPath(project))
  }, [added, state, navigate])

  const add = async () => {
    if (draft === undefined || !readyToAdd(check)) return
    const before = state.projects
    if (!(await send('project/add', { ...draft }))) return
    kept = null
    setAdded({ key: draft.key.trim(), before })
  }

  const ready = readyToAdd(check)
  const missing = ready ? null : missingOf(fields, shape, check)
  const branchShown = branchOpen || noBranch || (root !== null && current === null)
  const keyText = fields.key.trim() || 'KEY'

  return (
    <div className="page accounts-page project-add">
      <header className="accounts-page__head">
        <h1 className="page__title">{t.wizard.title}</h1>
        {state.projects.length > 0 && (
          <Link to="/" className="button">
            ← {t.wizard.back}
          </Link>
        )}
      </header>
      <p className="queue__hint">{state.projects.length === 0 ? `${t.wizard.first} ${t.wizard.hint}` : t.wizard.hint}</p>
      <form
        className="add-window settings__form project-add__form"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <Step title={t.wizard.stepAgent}>
          <div className="settings__field">
            <FieldHead label={t.wizard.agent} hint={t.wizard.agentHint} htmlFor="wizard-agent" />
            <Select
              id="wizard-agent"
              className="settings__text settings__short"
              value={agent}
              options={providerOptions().map((option) => (option.value === shared ? { ...option, label: t.wizard.sharedAgent(option.label) } : option))}
              onChange={(value) => set({ provider: value === shared ? '' : value })}
            />
          </div>
          <AgentReady state={state} provider={agent} />
        </Step>
        <Step title={t.wizard.stepRepo}>
          <div className="settings__field">
            <FieldHead label={t.wizard.path} hint={t.wizard.repoHint} htmlFor="wizard-repo" />
            <input
              id="wizard-repo"
              className="settings__text settings__text--mono"
              spellCheck={false}
              autoFocus
              value={fields.repo}
              placeholder={t.wizard.repoPlaceholder}
              aria-invalid={repoCheck?.repo.notice != null}
              onChange={(event) => set({ repo: event.target.value })}
            />
            {repoCheck !== null && repoCheck.repo.root !== null && repoCheck.repo.notice === null && (
              <Status ok>
                {t.wizard.repoFound(repoCheck.repo.root)}
                {!branchShown && (
                  <>
                    {' · '}
                    {t.wizard.mainBranch(fields.branch || current || 'main')}{' '}
                    <button type="button" className="link-button" onClick={() => setBranchOpen(true)}>
                      [{t.wizard.changeBranch}]
                    </button>
                  </>
                )}
              </Status>
            )}
            {repoCheck?.repo.notice != null && (
              <Status>
                {say(repoCheck.repo.notice)}
                {repoCheck.repo.notice.code === 'wizard.repoTaken' && (
                  <>
                    {' '}
                    <Link to={projectPath(repoCheck.repo.notice.params.project)}>{t.wizard.openProject}</Link>
                  </>
                )}
              </Status>
            )}
          </div>
          {branchShown && (
            <div className="settings__field">
              <FieldHead label={t.settings.branch} hint={t.settings.branchHint} htmlFor="wizard-branch" />
              <input
                id="wizard-branch"
                className="settings__text settings__text--mono settings__short"
                spellCheck={false}
                value={fields.branch}
                placeholder={current ?? 'main'}
                onChange={(event) => set({ branch: event.target.value })}
              />
            </div>
          )}
          {repoCheck?.trusted === false && repoCheck.repo.root !== null && (
            <div className="notice notice--warn project-add__trust">
              <p>{t.wizard.untrusted}</p>
              <TrustCommand command={trustCommand(repoCheck.repo.root, repoCheck.platform)} />
              <p>{t.wizard.trustUser(repoCheck.user)}</p>
              <TrustCommand command={trustCommandAs(repoCheck.repo.root, repoCheck.platform, repoCheck.user)} />
            </div>
          )}
          {repoCheck?.trusted === true && <Status ok>{t.wizard.trusted}</Status>}
        </Step>
        <Step title={t.wizard.stepTracker}>
          <TrackerStep state={state} fields={fields} shape={shape} check={check} onChange={setFields} />
        </Step>
        <Step title={t.wizard.stepProject}>
          <div className="settings__row">
            {keyTyped(shape) && (
              <div className="settings__field">
                <FieldHead
                  label={shape === 'place' ? t.wizard.prefix : t.wizard.ownKey}
                  hint={shape === 'place' ? t.wizard.prefixHint : t.wizard.ownKeyHint}
                  htmlFor="wizard-key"
                />
                <input
                  id="wizard-key"
                  className="settings__text settings__text--mono project-add__key"
                  spellCheck={false}
                  maxLength={5}
                  value={fields.key}
                  placeholder="ABC"
                  aria-invalid={check?.entry != null}
                  onChange={(event) => setFields((before) => typedIn(before, 'key', keyOfTyped(event.target.value)))}
                />
              </div>
            )}
            <div className="settings__field settings__grow">
              <FieldHead label={t.wizard.name} hint={t.wizard.nameHint} htmlFor="wizard-name" />
              <input
                id="wizard-name"
                className="settings__text"
                value={fields.name}
                placeholder={fields.key || t.wizard.namePlaceholder}
                onChange={(event) => setFields((before) => typedIn(before, 'name', event.target.value))}
              />
            </div>
          </div>
          <span className="settings__hint">{t.wizard.example(idPrefix(shape, fields) || keyText, shape === 'place', keptIds(shape, fields))}</span>
          {keyTyped(shape) && check?.entry != null && fields.key.trim() !== '' && <Status>{say(check.entry)}</Status>}
          {(milestonesOpen || trackerShared || fields.milestones.trim() !== '') && (
            <div className="settings__field">
              <FieldHead label={t.settings.rule.requiredMilestones} hint={t.wizard.milestonesHint} />
              <ListTable
                label={t.settings.rule.requiredMilestones}
                value={fields.milestones}
                add={t.settings.ruleAdd.requiredMilestones}
                empty={t.settings.rulePlaceholder.requiredMilestones}
                suggest={ruleChoicesOf(state.tasks).milestones}
                onChange={(milestones) => set({ milestones })}
              />
              {check !== null && check.yields.length > 0 && <Status ok>{t.wizard.yields(check.yields.join(', '))}</Status>}
            </div>
          )}
        </Step>
        <details className="project-add__advanced">
          <summary>
            {t.wizard.advanced} <span className="settings__hint">({t.wizard.placeNow(draft?.slot ?? 0)})</span>
          </summary>
          <div className="project-add__places" role="radiogroup" aria-label={t.wizard.stepPlace}>
            <label className="settings__check">
              <input type="radio" name="wizard-place" checked={fields.place === 'worktree'} onChange={() => set({ place: 'worktree' })} />
              {t.wizard.placeWorktree}
            </label>
            <label className="settings__check">
              <input type="radio" name="wizard-place" checked={fields.place === 'slots'} onChange={() => set({ place: 'slots' })} />
              {t.wizard.placeSlots}
              <input
                className="settings__text project-add__slots"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                aria-label={t.settings.slot}
                value={fields.slots}
                disabled={fields.place !== 'slots'}
                aria-invalid={fields.place === 'slots' && draft === undefined}
                onChange={(event) => set({ slots: event.target.value })}
              />
            </label>
          </div>
          <p className="settings__hint">{t.wizard.placeHint}</p>
        </details>
        {checkFailure !== null && <p className="notice notice--error">{say(checkFailure)}</p>}
        {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
        <div className="account__actions project-add__actions">
          <button type="submit" className="button button--primary" disabled={sending || added !== null || !ready}>
            {t.wizard.add}
          </button>
          {draft !== undefined && draft.repo !== '' && (
            <button type="button" className="button" disabled={checking} onClick={() => setRound((count) => count + 1)}>
              {t.wizard.checkAgain}
            </button>
          )}
          {checking || missing === 'checking' ? (
            <span className="settings__hint">{t.wizard.checking}</span>
          ) : (
            missing !== null && <span className="settings__hint">{missingText(missing, fields, state)}</span>
          )}
        </div>
      </form>
    </div>
  )
}

/** The key typed where the task ids stay the tracker's, when it is not their prefix: the example says it does not change them. */
function keptIds(shape: TrackerShape, fields: WizardFields): string | null {
  const key = fields.key.trim()
  const prefix = idPrefix(shape, fields)
  return prefix === '' || key === '' || key === prefix ? null : key
}

/** The only tracker profile is chosen at once; with several the user picks. */
function firstFields(state: EvenKeelState): WizardFields {
  const trackers = new Set(state.profiles.kinds.filter((kind) => kind.tracker).map((kind) => kind.kind))
  const own = state.profiles.profiles.filter((profile) => trackers.has(profile.kind))
  return own.length === 1 ? switchProfile(EMPTY_FIELDS, own[0]!) : EMPTY_FIELDS
}

function missingText(missing: Exclude<Missing, 'checking'>, fields: WizardFields, state: EvenKeelState): string {
  const choice = state.config.trackers.find((each) => each.name === fields.tracker)
  const title = choice?.title ?? fields.tracker
  if (missing === 'project' && shapeOf(choice) === 'within') return t.wizard.missing.field(t.wizard.team)
  if (missing === 'place' || missing === 'project') return t.wizard.missing.field(t.settings.trackerProject(fields.tracker, title))
  if (missing === 'key') return t.wizard.missing.field(t.wizard.prefix)
  return t.wizard.missing[missing]
}

/** The command as selectable text; the copy button only where the page has the clipboard (plain HTTP from another host has none). */
function TrustCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const canCopy = typeof navigator !== 'undefined' && navigator.clipboard !== undefined
  const copy = () => {
    navigator.clipboard.writeText(command).then(
      () => setCopied(true),
      () => undefined,
    )
  }
  return (
    <div className="project-add__command">
      <code className="settings__text--mono">{command}</code>
      {canCopy && (
        <button type="button" className="button" onClick={copy}>
          {copied ? t.wizard.commandCopied : t.wizard.copyCommand}
        </button>
      )}
    </div>
  )
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="project-add__step">
      <legend className="project-add__legend">{title}</legend>
      {children}
    </fieldset>
  )
}
