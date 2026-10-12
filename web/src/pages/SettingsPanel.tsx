import { useEffect, useRef, type ReactNode } from 'react'
import { CI_KINDS, type CiKind } from '../../../src/ci/model.js'
import type { Notice } from '../../../src/notice/notice.js'
import type { ConfigView, ProjectForm } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { SlidersIcon } from '../ui/icons.js'
import { changed, edited, reverted, sent, type Value, type Values } from './settingsDraft.js'
import {
  FieldNote,
  GroupTabs,
  linesOf,
  marksOf,
  RestartMark,
  RULE_KEYS,
  RuleFields,
  rulesOf,
  rulesText,
  sameBy,
  SaveBar,
  shown,
  unplaced,
  UnsavedDot,
  useFieldErrors,
  wholeOf,
} from './settingsParts.js'
import { useDraft, useTab } from './settingsStore.js'
import './settings.css'

/** The address hash that opens the settings panel; a task id never equals it. */
export const SETTINGS_HASH = 'settings'

export function SettingsChip({ open, tab = false, dirty, onToggle }: { open: boolean; tab?: boolean; dirty: boolean; onToggle: () => void }) {
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
      {dirty && <UnsavedDot />}
    </button>
  )
}

// Related fields share a group, so a save of one group never leaves another half-agreeing with it.
const GROUPS = [
  { id: 'repo', keys: ['repo', 'branch', 'slot'] },
  { id: 'tracker', keys: ['tracker', 'trackerProject', 'fillMilestone', ...RULE_KEYS] },
  { id: 'sessions', keys: ['brief', 'prompt', 'beforeStart'] },
  { id: 'ci', keys: ['check', 'kinds', 'wait', 'recheck', 'fixTask'] },
] as const
type GroupId = (typeof GROUPS)[number]['id']
const KEYS: readonly string[] = GROUPS.flatMap((group) => group.keys)
const keysOf = (id: GroupId): readonly string[] => GROUPS.find((group) => group.id === id)!.keys
const same = sameBy(['beforeStart', 'check', ...RULE_KEYS])
const scopeOf = (project: string) => `project:${project}`

const valuesOf = (form: ProjectForm): Values => ({
  repo: form.repo,
  branch: form.branch,
  tracker: form.tracker,
  trackerProject: form.trackerProject ?? '',
  slot: String(form.slot),
  brief: form.brief,
  ...rulesText(form.chain),
  prompt: form.prompt ?? '',
  beforeStart: form.beforeStart.join('\n'),
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
function formOf(values: Values): ProjectForm | undefined {
  const text = (key: string) => values[key] as string
  const on = (key: string) => values[key] as boolean
  const waitMinutes = minutesOf(text('wait'))
  const slot = wholeOf(text('slot'), 0)
  if (waitMinutes === undefined || slot === undefined) return undefined
  const trackerProject = text('trackerProject').trim()
  const kinds = values.kinds as readonly string[]
  return {
    repo: text('repo').trim(),
    branch: text('branch').trim(),
    tracker: text('tracker'),
    trackerProject: trackerProject === '' ? null : trackerProject,
    slot,
    brief: on('brief'),
    chain: rulesOf(values as Record<(typeof RULE_KEYS)[number], Value>),
    prompt: text('prompt').trim(),
    beforeStart: linesOf(text('beforeStart')),
    check: linesOf(text('check')),
    ci: { kinds: CI_KINDS.filter((kind) => kinds.includes(kind)), waitMinutes, recheckMain: on('recheck'), fixTask: on('fixTask') },
    fillMilestone: on('fillMilestone'),
  }
}

/** Whether a group of the project's settings holds changes nobody saved yet: the Settings tab shows it even with the panel closed. */
export function useSettingsDirty(project: string, form: ProjectForm | undefined): boolean {
  const [draft] = useDraft(scopeOf(project), form === undefined ? undefined : valuesOf(form), same)
  return draft !== undefined && changed(draft, KEYS, same).length > 0
}

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
  const saved = valuesOf(form)
  const [current, setDraft] = useDraft(scopeOf(project), saved, same)
  const draft = current!
  const [open, setOpen] = useTab<GroupId>(scopeOf(project), 'repo')
  const dirty = (id: GroupId) => changed(draft, keysOf(id), same).length > 0
  const outgoing = sent(draft, keysOf(open))
  const next = formOf(outgoing.form)
  const base = formOf(outgoing.base)
  const errorOf = useFieldErrors(project, [failure, configError], config)
  const restart = (field: string) => config.restart.includes(`${project}.${field}`)
  const text = (key: string) => draft.edit[key] as string
  const on = (key: string) => draft.edit[key] as boolean
  const tracker = config.trackers.find((each) => each.name === text('tracker'))
  const kinds = draft.edit.kinds as readonly CiKind[]

  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.querySelector('dialog[open]') === null) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const edit = (key: string, value: Value) => setDraft(edited(draft, key, value))
  const revert = (keys: readonly string[]) => setDraft(reverted(draft, saved, keys))
  const marks = marksOf(draft, saved, same, revert)
  const toggle = (kind: CiKind, checked: boolean) => edit('kinds', CI_KINDS.filter((each) => (each === kind ? checked : kinds.includes(each))))
  const save = async () => {
    if (next === undefined || base === undefined) return
    await send('project/settings', { project, ...next, base })
  }
  const leftover = unplaced(project, failure, config)
  const check = (key: string, label: string, hint: string, error?: string) => (
    <div className={marks.box(key)}>
      <label className="settings__check">
        <input type="checkbox" checked={on(key)} onChange={(event) => edit(key, event.target.checked)} />
        {label}
      </label>
      <span className="settings__hint">{hint}</span>
      {marks.note(key)}
      {error !== undefined && <FieldNote error={errorOf(error)} />}
    </div>
  )

  const groups: Record<GroupId, () => ReactNode> = {
    repo: () => (
      <>
        <label className={marks.box('repo')}>
          <span className="settings__label">
            {t.settings.repo}
            <RestartMark on={restart('repo')} />
          </span>
          <span className="settings__hint">{t.settings.repoHint}</span>
          <input
            className="settings__text settings__text--mono"
            spellCheck={false}
            value={text('repo')}
            aria-invalid={errorOf('repo') !== null}
            onChange={(event) => edit('repo', event.target.value)}
          />
          {marks.note('repo')}
          <FieldNote error={errorOf('repo')} />
        </label>
        <label className={marks.box('branch')}>
          <span className="settings__label">{t.settings.branch}</span>
          <span className="settings__hint">{t.settings.branchHint}</span>
          <input
            className="settings__text settings__text--mono settings__short"
            spellCheck={false}
            value={text('branch')}
            placeholder="main"
            aria-invalid={errorOf('branch') !== null}
            onChange={(event) => edit('branch', event.target.value)}
          />
          {marks.note('branch')}
          <FieldNote error={errorOf('branch')} />
        </label>
        <label className={marks.box('slot')}>
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
            value={text('slot')}
            aria-invalid={wholeOf(text('slot'), 0) === undefined || errorOf('slot') !== null}
            onChange={(event) => edit('slot', event.target.value)}
          />
          {marks.note('slot')}
          <FieldNote error={errorOf('slot')} />
        </label>
      </>
    ),
    tracker: () => (
      <>
        <div className="settings__row">
          <label className={marks.box('tracker')}>
            <span className="settings__label">
              {t.settings.tracker}
              <RestartMark on={restart('tracker')} />
            </span>
            <select
              className="settings__text settings__short"
              value={text('tracker')}
              aria-invalid={errorOf('tracker') !== null}
              onChange={(event) => edit('tracker', event.target.value)}
            >
              {config.trackers.map((each) => (
                <option key={each.name} value={each.name}>
                  {each.name}
                </option>
              ))}
            </select>
            {marks.note('tracker')}
            <FieldNote error={errorOf('tracker')} />
          </label>
          {tracker?.projectKey != null && (
            <label className={marks.box('trackerProject', 'settings__field settings__grow')}>
              <span className="settings__label">
                {t.settings.trackerProject(tracker.projectKey.key)}
                <RestartMark on={restart('trackerProject')} />
              </span>
              <input
                className="settings__text settings__text--mono"
                spellCheck={false}
                value={text('trackerProject')}
                placeholder={tracker.projectKey.example}
                aria-invalid={errorOf('trackerProject') !== null}
                onChange={(event) => edit('trackerProject', event.target.value)}
              />
              {tracker.projectKey.optional && <span className="settings__hint">{t.settings.trackerProjectOptional}</span>}
              {marks.note('trackerProject')}
              <FieldNote error={errorOf('trackerProject')} />
            </label>
          )}
        </div>
        {check('fillMilestone', t.settings.fillMilestone, t.settings.fillMilestoneHint, 'fillMilestone')}
        <RuleFields text={text} onEdit={edit} errorOf={errorOf} marks={marks} />
      </>
    ),
    sessions: () => (
      <>
        {check('brief', t.settings.brief, t.settings.briefHint, 'brief')}
        <label className={marks.box('prompt')}>
          <span className="settings__label">{t.settings.prompt}</span>
          <span className="settings__hint">{t.settings.promptHint}</span>
          <textarea
            className="settings__text"
            rows={5}
            value={text('prompt')}
            placeholder={t.settings.promptPlaceholder}
            onChange={(event) => edit('prompt', event.target.value)}
          />
          {marks.note('prompt')}
          <FieldNote error={errorOf('prompt')} />
        </label>
        <label className={marks.box('beforeStart')}>
          <span className="settings__label">{t.settings.beforeStart}</span>
          <span className="settings__hint">{t.settings.beforeStartHint}</span>
          <textarea
            className="settings__text settings__text--mono"
            rows={4}
            spellCheck={false}
            value={text('beforeStart')}
            placeholder={t.settings.beforeStartPlaceholder}
            onChange={(event) => edit('beforeStart', event.target.value)}
          />
          {marks.note('beforeStart')}
          <FieldNote error={errorOf('beforeStart')} />
        </label>
      </>
    ),
    ci: () => (
      <>
        <label className={marks.box('check')}>
          <span className="settings__label">{t.settings.check}</span>
          <span className="settings__hint">{t.settings.checkHint}</span>
          <textarea
            className="settings__text settings__text--mono"
            rows={3}
            spellCheck={false}
            value={text('check')}
            placeholder={t.settings.checkPlaceholder}
            onChange={(event) => edit('check', event.target.value)}
          />
          {marks.note('check')}
          <FieldNote error={errorOf('check')} />
        </label>
        <fieldset className={marks.box('kinds', 'settings__field settings__group')}>
          <legend className="settings__label">{t.settings.ci}</legend>
          <span className="settings__hint">{t.settings.ciHint}</span>
          <div className="settings__checks">
            {CI_KINDS.map((kind) => (
              <label key={kind} className="settings__check">
                <input type="checkbox" checked={kinds.includes(kind)} onChange={(event) => toggle(kind, event.target.checked)} />
                {t.settings.ciKinds[kind]}
              </label>
            ))}
          </div>
          {marks.note('kinds', (value) => shown((value as CiKind[]).map((kind) => t.settings.ciKinds[kind])))}
          <FieldNote error={errorOf('ci')} />
        </fieldset>
        <label className={marks.box('wait')}>
          <span className="settings__label">{t.settings.ciWait}</span>
          <span className="settings__hint">{t.settings.ciWaitHint}</span>
          <input
            className="settings__text settings__number"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={text('wait')}
            placeholder={t.settings.ciWaitPlaceholder}
            aria-invalid={minutesOf(text('wait')) === undefined}
            onChange={(event) => edit('wait', event.target.value)}
          />
          {marks.note('wait', (value) => ((value as string).trim() === '' ? t.settings.ciWaitPlaceholder : shown(value)))}
        </label>
        {check('recheck', t.settings.recheckMain, t.settings.recheckMainHint)}
        {check('fixTask', t.settings.fixTask, t.settings.fixTaskHint)}
      </>
    ),
  }

  return (
    <aside className="panel settings" aria-label={t.settings.title}>
      <header className="panel__head settings__head">
        <GroupTabs groups={GROUPS.map(({ id }) => ({ id, title: t.settings.groups[id] }))} open={open} dirty={dirty} onOpen={setOpen} />
        <button ref={closeRef} type="button" className="panel__close" aria-label={t.session.closePanel} onClick={onClose}>
          ×
        </button>
      </header>
      <p className="chain__hint">{t.settings.hint}</p>
      <form
        className="settings__form"
        role="tabpanel"
        aria-labelledby={`settings-tab-${open}`}
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {groups[open]()}
        {leftover !== null && <p className="notice notice--error">{say(leftover)}</p>}
        {dirty(open) && <SaveBar canSave={!sending && next !== undefined} onRevert={() => revert(keysOf(open))} />}
      </form>
    </aside>
  )
}
