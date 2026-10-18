import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState, ProjectCheck, ProjectDraft } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { projectPath } from '../state.js'
import { Select } from '../ui/Select.js'
import { draftOfFields, EMPTY_FIELDS, keyOfFolder, readyToAdd, type WizardFields } from './projectWizard.js'
import { FieldHead } from './settingsParts.js'
import './accounts.css'
import './settings.css'
import './projectAdd.css'

const CHECK_DELAY_MS = 600

interface Checked {
  draft: ProjectDraft
  result: ProjectCheck
}

/**
 * Adding a project: the repository, the key and name, the tracker and the place of the tasks' folders, each checked by the
 * service as it is typed; "Add" writes the entry into the config once the repository, the entry and the tracker pass.
 */
export function ProjectAddPage({ state }: { state: EvenKeelState }) {
  const { checkProject } = useLive()
  const navigate = useNavigate()
  const { send, sending, failure } = useCommand()
  const [fields, setFields] = useState<WizardFields>(() => ({ ...EMPTY_FIELDS, tracker: state.config.shared.tracker }))
  const [checked, setChecked] = useState<Checked | null>(null)
  const [checkFailure, setCheckFailure] = useState<Notice | null>(null)
  const [checking, setChecking] = useState(false)
  const [round, setRound] = useState(0)
  const [added, setAdded] = useState<string | null>(null)
  const draft = draftOfFields(fields)
  const draftText = JSON.stringify(draft ?? null)
  const fresh = checked !== null && JSON.stringify(checked.draft) === draftText
  const check = fresh ? checked.result : null
  const tracker = state.config.trackers.find((each) => each.name === fields.tracker)
  const set = (change: Partial<WizardFields>) => setFields((before) => ({ ...before, ...change }))

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

  // A repository found: its current branch and a key from its folder's name fill the fields still blank.
  const root = checked?.result.repo.root ?? null
  const current = checked?.result.repo.current ?? null
  useEffect(() => {
    if (root === null) return
    setFields((before) => ({ ...before, branch: before.branch || (current ?? ''), key: before.key || keyOfFolder(root) }))
  }, [root, current])

  useEffect(() => {
    if (added !== null && state.projectIds[added] !== undefined) void navigate(projectPath(state, added))
  }, [added, state, navigate])

  const add = async () => {
    if (draft === undefined || !readyToAdd(check)) return
    if (await send('project/add', { ...draft })) setAdded(draft.key)
  }

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
      <p className="queue__hint">{state.projects.length === 0 ? t.wizard.first : t.wizard.hint}</p>
      <form
        className="add-window settings__form project-add__form"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
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
              aria-invalid={check?.repo.notice != null}
              onChange={(event) => set({ repo: event.target.value })}
            />
            {check !== null && check.repo.root !== null && check.repo.notice === null && <Status ok>{t.wizard.repoFound(check.repo.root)}</Status>}
            {check?.repo.notice != null && <Status>{say(check.repo.notice)}</Status>}
          </div>
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
          {check?.trusted === false && (
            <p className="notice notice--warn project-add__trust">{t.wizard.untrusted}</p>
          )}
          {check?.trusted === true && <Status ok>{t.wizard.trusted}</Status>}
        </Step>
        <Step title={t.wizard.stepProject}>
          <div className="settings__row">
            <div className="settings__field">
              <FieldHead label={t.wizard.key} hint={t.wizard.keyHint} htmlFor="wizard-key" />
              <input
                id="wizard-key"
                className="settings__text settings__text--mono project-add__key"
                spellCheck={false}
                maxLength={5}
                value={fields.key}
                placeholder="ABC"
                aria-invalid={check?.entry != null}
                onChange={(event) => set({ key: event.target.value.toUpperCase() })}
              />
            </div>
            <div className="settings__field settings__grow">
              <FieldHead label={t.wizard.name} hint={t.wizard.nameHint} htmlFor="wizard-name" />
              <input
                id="wizard-name"
                className="settings__text"
                value={fields.name}
                placeholder={fields.key || t.wizard.namePlaceholder}
                onChange={(event) => set({ name: event.target.value })}
              />
            </div>
          </div>
          {check?.entry != null && fields.key.trim() !== '' && <Status>{say(check.entry)}</Status>}
        </Step>
        <Step title={t.wizard.stepTracker}>
          <div className="settings__row">
            <div className="settings__field">
              <FieldHead label={t.wizard.service} htmlFor="wizard-tracker" />
              <Select
                id="wizard-tracker"
                className="settings__text settings__short"
                value={fields.tracker}
                options={state.config.trackers.map((each) => ({ value: each.name, label: each.name }))}
                onChange={(value) => set({ tracker: value, trackerProject: '' })}
              />
            </div>
            {tracker?.projectKey != null && (
              <div className="settings__field settings__grow">
                <FieldHead
                  label={t.settings.trackerProject(tracker.projectKey.key)}
                  hint={tracker.projectKey.optional ? t.settings.trackerProjectOptional : undefined}
                  htmlFor="wizard-tracker-project"
                />
                <input
                  id="wizard-tracker-project"
                  className="settings__text settings__text--mono"
                  spellCheck={false}
                  value={fields.trackerProject}
                  placeholder={tracker.projectKey.example}
                  onChange={(event) => set({ trackerProject: event.target.value })}
                />
              </div>
            )}
          </div>
          {check?.tracker?.ok === true && <Status ok>{t.wizard.trackerOk(check.tracker.open ?? 0)}</Status>}
          {check?.tracker?.notice != null && <Status>{say(check.tracker.notice)}</Status>}        </Step>
        <Step title={t.wizard.stepPlace}>
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
        </Step>
        {checkFailure !== null && <p className="notice notice--error">{say(checkFailure)}</p>}
        {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
        <div className="account__actions project-add__actions">
          <button type="submit" className="button button--primary" disabled={sending || added !== null || !readyToAdd(check)}>
            {t.wizard.add}
          </button>
          {draft !== undefined && draft.repo !== '' && (
            <button type="button" className="button" disabled={checking} onClick={() => setRound((count) => count + 1)}>
              {t.wizard.checkAgain}
            </button>
          )}
          {(checking || (draft !== undefined && draft.repo !== '' && !fresh)) && <span className="settings__hint">{t.wizard.checking}</span>}
        </div>
      </form>
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

function Status({ ok = false, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <span className={ok ? 'project-add__status project-add__status--ok' : 'project-add__status'} role={ok ? undefined : 'alert'}>
      {children}
    </span>
  )
}
