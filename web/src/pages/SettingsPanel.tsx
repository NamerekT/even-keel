import { useEffect, useRef, useState } from 'react'
import { CI_KINDS, type CiKind } from '../../../src/ci/model.js'
import type { Notice } from '../../../src/notice/notice.js'
import type { ConfigView, ProjectForm } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { SlidersIcon } from '../ui/icons.js'
import { FieldNote, linesOf, RestartMark, RuleFields, rulesOf, rulesText, unplaced, useFieldErrors, wholeOf, type RuleTexts } from './settingsParts.js'
import './settings.css'

/** The address hash that opens the settings panel; a task id never equals it. */
export const SETTINGS_HASH = 'settings'

export function SettingsChip({ open, tab = false, onToggle }: { open: boolean; tab?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={tab ? 'side-tab side-tab--wide' : 'tag tag--settings'}
      aria-expanded={open}
      title={t.settings.title}
      onClick={onToggle}
    >
      <SlidersIcon />
      {t.settings.open}
    </button>
  )
}

interface Draft {
  repo: string
  branch: string
  tracker: string
  trackerProject: string
  slot: string
  brief: boolean
  rules: RuleTexts
  prompt: string
  commands: string
  check: string
  kinds: CiKind[]
  wait: string
  recheck: boolean
  fixTask: boolean
  fillMilestone: boolean
}

const draftOf = (form: ProjectForm): Draft => ({
  repo: form.repo,
  branch: form.branch,
  tracker: form.tracker,
  trackerProject: form.trackerProject ?? '',
  slot: String(form.slot),
  brief: form.brief,
  rules: rulesText(form.chain),
  prompt: form.prompt ?? '',
  commands: form.beforeStart.join('\n'),
  check: form.check.join('\n'),
  kinds: form.ci.kinds,
  wait: form.ci.waitMinutes === null ? '' : String(form.ci.waitMinutes),
  recheck: form.ci.recheckMain,
  fixTask: form.ci.fixTask,
  fillMilestone: form.fillMilestone,
})
/** Empty — wait as long as it takes; `undefined` — not a whole number of minutes. */
const minutesOf = (text: string): number | null | undefined => (text.trim() === '' ? null : wholeOf(text, 0))

/** What the service gets; `undefined` while a number field holds something else. */
function formOf(draft: Draft): ProjectForm | undefined {
  const waitMinutes = minutesOf(draft.wait)
  const slot = wholeOf(draft.slot, 0)
  if (waitMinutes === undefined || slot === undefined) return undefined
  const trackerProject = draft.trackerProject.trim()
  return {
    repo: draft.repo.trim(),
    branch: draft.branch.trim(),
    tracker: draft.tracker,
    trackerProject: trackerProject === '' ? null : trackerProject,
    slot,
    brief: draft.brief,
    chain: rulesOf(draft.rules),
    prompt: draft.prompt.trim(),
    beforeStart: linesOf(draft.commands),
    check: linesOf(draft.check),
    ci: { kinds: CI_KINDS.filter((kind) => draft.kinds.includes(kind)), waitMinutes, recheckMain: draft.recheck, fixTask: draft.fixTask },
    fillMilestone: draft.fillMilestone,
  }
}
// What the service would store, so a stray space or blank line is not an unsaved change.
const sameDraft = (a: Draft, b: Draft) => JSON.stringify(formOf(a) ?? a) === JSON.stringify(formOf(b) ?? b)

export function SettingsPanel({
  project,
  form,
  config,
  configError,
  onClose,
}: {
  project: string
  form: ProjectForm
  config: ConfigView
  configError: Notice | null
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const { send, sending, failure } = useCommand()
  const saved = draftOf(form)
  const [draft, setDraft] = useState(saved)
  const [done, setDone] = useState(false)
  const previous = useRef(saved)
  const changed = !sameDraft(draft, saved)
  const next = formOf(draft)
  const errorOf = useFieldErrors(project, [failure, configError], config)
  const restart = (field: string) => config.restart.includes(`${project}.${field}`)
  const tracker = config.trackers.find((each) => each.name === draft.tracker)

  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])

  // The config changed under an untouched form (a save, or the file edited by hand): show the new values.
  useEffect(() => {
    if (sameDraft(previous.current, saved)) return
    if (sameDraft(draft, previous.current)) setDraft(saved)
    previous.current = saved
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.querySelector('dialog[open]') === null) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const edit = (change: Partial<Draft>) => {
    setDone(false)
    setDraft({ ...draft, ...change })
  }
  const toggle = (kind: CiKind, on: boolean) => edit({ kinds: CI_KINDS.filter((each) => (each === kind ? on : draft.kinds.includes(each))) })
  const save = async () => {
    if (next === undefined) return
    if (await send('project/settings', { project, ...next })) setDone(true)
  }
  const leftover = unplaced(project, failure, config)

  return (
    <aside className="panel settings" aria-label={t.settings.title}>
      <header className="panel__head">
        <h2 className="panel__task settings__title">
          <SlidersIcon />
          {t.settings.title}
        </h2>
        <button ref={closeRef} type="button" className="panel__close" aria-label={t.session.closePanel} onClick={onClose}>
          ×
        </button>
      </header>
      <p className="chain__hint">{t.settings.hint}</p>
      <form
        className="settings__form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label className="settings__field">
          <span className="settings__label">
            {t.settings.repo}
            <RestartMark on={restart('repo')} />
          </span>
          <span className="settings__hint">{t.settings.repoHint}</span>
          <input
            className="settings__text settings__text--mono"
            spellCheck={false}
            value={draft.repo}
            aria-invalid={errorOf('repo') !== null}
            onChange={(event) => edit({ repo: event.target.value })}
          />
          <FieldNote error={errorOf('repo')} />
        </label>
        <label className="settings__field">
          <span className="settings__label">{t.settings.branch}</span>
          <span className="settings__hint">{t.settings.branchHint}</span>
          <input
            className="settings__text settings__text--mono settings__short"
            spellCheck={false}
            value={draft.branch}
            placeholder="main"
            aria-invalid={errorOf('branch') !== null}
            onChange={(event) => edit({ branch: event.target.value })}
          />
          <FieldNote error={errorOf('branch')} />
        </label>
        <div className="settings__row">
          <label className="settings__field">
            <span className="settings__label">
              {t.settings.tracker}
              <RestartMark on={restart('tracker')} />
            </span>
            <select className="settings__text settings__short" value={draft.tracker} aria-invalid={errorOf('tracker') !== null} onChange={(event) => edit({ tracker: event.target.value })}>
              {config.trackers.map((each) => (
                <option key={each.name} value={each.name}>
                  {each.name}
                </option>
              ))}
            </select>
            <FieldNote error={errorOf('tracker')} />
          </label>
          {tracker?.projectKey != null && (
            <label className="settings__field settings__grow">
              <span className="settings__label">
                {t.settings.trackerProject(tracker.projectKey.key)}
                <RestartMark on={restart('trackerProject')} />
              </span>
              <input
                className="settings__text settings__text--mono"
                spellCheck={false}
                value={draft.trackerProject}
                placeholder={tracker.projectKey.example}
                aria-invalid={errorOf('trackerProject') !== null}
                onChange={(event) => edit({ trackerProject: event.target.value })}
              />
              {tracker.projectKey.optional && <span className="settings__hint">{t.settings.trackerProjectOptional}</span>}
              <FieldNote error={errorOf('trackerProject')} />
            </label>
          )}
        </div>
        <div className="settings__field">
          <label className="settings__check">
            <input type="checkbox" checked={draft.brief} onChange={(event) => edit({ brief: event.target.checked })} />
            {t.settings.brief}
          </label>
          <span className="settings__hint">{t.settings.briefHint}</span>
          <FieldNote error={errorOf('brief')} />
        </div>
        <label className="settings__field">
          <span className="settings__label">
            {t.settings.slot}
            <RestartMark on={restart('slot')} />
          </span>
          <span className="settings__hint">{t.settings.slotHint}</span>
          <input
            className="settings__text settings__number"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={draft.slot}
            aria-invalid={wholeOf(draft.slot, 0) === undefined || errorOf('slot') !== null}
            onChange={(event) => edit({ slot: event.target.value })}
          />
          <FieldNote error={errorOf('slot')} />
        </label>
        <label className="settings__field">
          <span className="settings__label">{t.settings.prompt}</span>
          <span className="settings__hint">{t.settings.promptHint}</span>
          <textarea
            className="settings__text"
            rows={5}
            value={draft.prompt}
            placeholder={t.settings.promptPlaceholder}
            onChange={(event) => edit({ prompt: event.target.value })}
          />
          <FieldNote error={errorOf('prompt')} />
        </label>
        <label className="settings__field">
          <span className="settings__label">{t.settings.beforeStart}</span>
          <span className="settings__hint">{t.settings.beforeStartHint}</span>
          <textarea
            className="settings__text settings__text--mono"
            rows={4}
            spellCheck={false}
            value={draft.commands}
            placeholder={t.settings.beforeStartPlaceholder}
            onChange={(event) => edit({ commands: event.target.value })}
          />
          <FieldNote error={errorOf('beforeStart')} />
        </label>
        <fieldset className="settings__field settings__group">
          <legend className="settings__label">{t.settings.ci}</legend>
          <span className="settings__hint">{t.settings.ciHint}</span>
          <div className="settings__checks">
            {CI_KINDS.map((kind) => (
              <label key={kind} className="settings__check">
                <input type="checkbox" checked={draft.kinds.includes(kind)} onChange={(event) => toggle(kind, event.target.checked)} />
                {t.settings.ciKinds[kind]}
              </label>
            ))}
          </div>
          <FieldNote error={errorOf('ci')} />
        </fieldset>
        <label className="settings__field">
          <span className="settings__label">{t.settings.ciWait}</span>
          <span className="settings__hint">{t.settings.ciWaitHint}</span>
          <input
            className="settings__text settings__number"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={draft.wait}
            placeholder={t.settings.ciWaitPlaceholder}
            aria-invalid={minutesOf(draft.wait) === undefined}
            onChange={(event) => edit({ wait: event.target.value })}
          />
        </label>
        <label className="settings__field">
          <span className="settings__label">{t.settings.check}</span>
          <span className="settings__hint">{t.settings.checkHint}</span>
          <textarea
            className="settings__text settings__text--mono"
            rows={3}
            spellCheck={false}
            value={draft.check}
            placeholder={t.settings.checkPlaceholder}
            onChange={(event) => edit({ check: event.target.value })}
          />
          <FieldNote error={errorOf('check')} />
        </label>
        <div className="settings__field">
          <label className="settings__check">
            <input type="checkbox" checked={draft.recheck} onChange={(event) => edit({ recheck: event.target.checked })} />
            {t.settings.recheckMain}
          </label>
          <span className="settings__hint">{t.settings.recheckMainHint}</span>
        </div>
        <div className="settings__field">
          <label className="settings__check">
            <input type="checkbox" checked={draft.fixTask} onChange={(event) => edit({ fixTask: event.target.checked })} />
            {t.settings.fixTask}
          </label>
          <span className="settings__hint">{t.settings.fixTaskHint}</span>
        </div>
        <div className="settings__field">
          <label className="settings__check">
            <input type="checkbox" checked={draft.fillMilestone} onChange={(event) => edit({ fillMilestone: event.target.checked })} />
            {t.settings.fillMilestone}
          </label>
          <span className="settings__hint">{t.settings.fillMilestoneHint}</span>
          <FieldNote error={errorOf('fillMilestone')} />
        </div>
        <RuleFields texts={draft.rules} onEdit={(rules) => edit({ rules })} errorOf={errorOf} />
        <div className="settings__actions">
          <button type="submit" className="button button--primary" disabled={sending || !changed || next === undefined}>
            {t.settings.save}
          </button>
          {done && !changed && <span className="settings__saved">{t.settings.saved}</span>}
        </div>
        {leftover !== null && <p className="notice notice--error">{say(leftover)}</p>}
      </form>
    </aside>
  )
}
