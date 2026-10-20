import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import { CI_KINDS, type CiKind } from '../../../src/ci/model.js'
import type { Notice } from '../../../src/notice/notice.js'
import type { CacheTtl, ConfigView, OwnKey, OwnValues, ProjectForm, SharedForm } from '../../../src/state.js'
import { LANGUAGES } from '../../../src/language.js'
import type { Task } from '../../../src/tracker/model.js'
import { offeredProviders } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { PROJECT_SLOTS } from '../state.js'
import { SlidersIcon } from '../ui/icons.js'
import { Select } from '../ui/Select.js'
import { seriesStyle } from '../ui/series.js'
import { changed, edited, reverted, sent, type Value, type Values } from './settingsDraft.js'
import { accountOptions, namedProviders, providerKeys, providerMap, providerName, providerOptions, providerValues } from './settingsRun.js'
import {
  CheckField,
  FieldHead,
  fieldId,
  FieldNote,
  GroupTabs,
  linesOf,
  marksOf,
  minutesOf,
  ProviderGrid,
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
import { ruleChoicesOf } from './settingsRows.js'
import { useVocabularies } from './useVocabularies.js'
import { ProjectRemove } from './ProjectRemove.js'
import { ProfileLink } from './ProfileSelect.js'
import { remoteChoices } from './remoteProfiles.js'
import { useDraft, useTab } from './settingsStore.js'
import { SEG_CLASS, type ChipLook } from './chipLook.js'
import './settings.css'

/** The address hash that opens the settings panel; a task id never equals it. */
export const SETTINGS_HASH = 'settings'

const CHIP_CLASS: Record<ChipLook, string> = { tag: 'tag tag--settings', tab: 'side-tab side-tab--wide', seg: SEG_CLASS }

export function SettingsChip({ open, look = 'tag', dirty, onToggle }: { open: boolean; look?: ChipLook; dirty: boolean; onToggle: () => void }) {
  const seg = look === 'seg'
  return (
    <button
      type="button"
      className={CHIP_CLASS[look]}
      aria-expanded={open}
      aria-label={seg ? t.settings.open : undefined}
      title={t.settings.title}
      onClick={onToggle}
    >
      <SlidersIcon />
      {!seg && t.settings.open}
      {dirty && <UnsavedDot />}
    </button>
  )
}

const remoteKey = (kind: CiKind) => `remote.${kind}`
const FORGES: Record<CiKind, string> = { github: 'GitHub', forgejo: 'Forgejo' }

// Related fields share a group, so a save of one group never leaves another half-agreeing with it.
const GROUPS = [
  { id: 'repo', keys: ['repo', 'branch', 'slot', 'changelog', 'color'] },
  { id: 'tracker', keys: ['tracker', 'trackerProject', 'fillMilestone', ...RULE_KEYS] },
  {
    id: 'sessions',
    keys: ['provider', ...providerKeys('models'), ...providerKeys('accounts'), 'modelLabels', 'brief', 'prompt', 'beforeStart', 'promptLanguage', 'cacheTtl', 'ownCheckpoint', 'checkpointTokens'],
  },
  { id: 'ci', keys: ['guard', 'check', 'afterGreen', 'ownKinds', 'kinds', 'ownWait', 'wait', 'recheck', 'fixTask', 'pullRequests', ...CI_KINDS.map(remoteKey)] },
] as const
type GroupId = (typeof GROUPS)[number]['id']
const KEYS: readonly string[] = GROUPS.flatMap((group) => group.keys)
const keysOf = (id: GroupId): readonly string[] => GROUPS.find((group) => group.id === id)!.keys
const same = sameBy(['beforeStart', 'check', 'afterGreen', ...RULE_KEYS])
const scopeOf = (project: string) => `project:${project}`

const valuesOf = (form: ProjectForm): Values => ({
  repo: form.repo,
  branch: form.branch,
  tracker: form.tracker,
  trackerProject: form.trackerProject ?? '',
  slot: String(form.slot),
  color: form.color === null ? '' : String(form.color),
  brief: form.brief === null ? '' : String(form.brief),
  ...rulesText(form.chain),
  prompt: form.prompt ?? '',
  beforeStart: form.beforeStart.join('\n'),
  check: form.check.join('\n'),
  afterGreen: form.afterGreen.join('\n'),
  // A switch the project may leave to the shared settings: '' — as shared, 'true' or 'false' — its own.
  guard: switchText(form.own['ci.guard']),
  ownKinds: form.own['ci.kinds'] !== undefined,
  kinds: form.ci.kinds,
  ownWait: form.own['ci.waitMinutes'] !== undefined,
  wait: form.ci.waitMinutes === null ? '' : String(form.ci.waitMinutes),
  recheck: switchText(form.own['ci.recheckMain']),
  fixTask: switchText(form.own['ci.fixTask']),
  pullRequests: form.pullRequests,
  ...Object.fromEntries(CI_KINDS.map((kind) => [remoteKey(kind), form.remoteProfiles[kind] ?? ''])),
  fillMilestone: switchText(form.own.fillMilestone),
  changelog: form.changelog,
  provider: form.provider ?? '',
  ...providerValues('models', form.models),
  ...providerValues('accounts', form.accounts),
  modelLabels: form.modelLabels === null ? '' : String(form.modelLabels),
  promptLanguage: form.own.promptLanguage ?? '',
  cacheTtl: form.own.cacheTtl === undefined ? '' : (form.own.cacheTtl ?? CLI_TTL),
  ownCheckpoint: form.own['stats.checkpointTokens'] !== undefined,
  checkpointTokens: form.checkpointTokens === null ? '' : String(form.checkpointTokens),
})
const switchText = (value: boolean | undefined) => (value === undefined ? '' : String(value))
const switchOf = (text: string) => (text === '' ? undefined : text === 'true')
/** The choice of the cache lifetime that leaves it to Claude Code, as against '' — as shared. */
const CLI_TTL = 'cli'
const ttlLabel = (ttl: CacheTtl | null) => (ttl === null ? t.shared.cacheTtlAuto : ttl === '5m' ? t.shared.cacheTtl5m : t.shared.cacheTtl1h)
/** Empty — calibrated; `undefined` — not a whole number. */
const tokensOf = (text: string): number | null | undefined => (text.trim() === '' ? null : wholeOf(text, 0))

/** The project's own values of the keys Even Keel sets too; `undefined` while an own number field holds something else. */
function ownOf(values: Values): OwnValues | undefined {
  const text = (key: string) => values[key] as string
  const on = (key: string) => values[key] as boolean
  const waitMinutes = on('ownWait') ? minutesOf(text('wait')) : null
  const checkpointTokens = on('ownCheckpoint') ? tokensOf(text('checkpointTokens')) : null
  if (waitMinutes === undefined || checkpointTokens === undefined) return undefined
  const kinds = values.kinds as readonly string[]
  const ttl = text('cacheTtl')
  const entries: [OwnKey, unknown][] = [
    ['ci.guard', switchOf(text('guard'))],
    ['ci.kinds', on('ownKinds') ? CI_KINDS.filter((kind) => kinds.includes(kind)) : undefined],
    ['ci.waitMinutes', on('ownWait') ? waitMinutes : undefined],
    ['ci.recheckMain', switchOf(text('recheck'))],
    ['ci.fixTask', switchOf(text('fixTask'))],
    ['fillMilestone', switchOf(text('fillMilestone'))],
    ['promptLanguage', text('promptLanguage') === '' ? undefined : text('promptLanguage')],
    ['cacheTtl', ttl === '' ? undefined : ttl === CLI_TTL ? null : ttl],
    ['stats.checkpointTokens', on('ownCheckpoint') ? checkpointTokens : undefined],
  ]
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined)) as OwnValues
}

/** The project's own value of a key, else the shared one. */
const ownOr = <K extends OwnKey>(own: OwnValues, key: K, shared: Exclude<OwnValues[K], undefined>) => (key in own ? (own[key] as typeof shared) : shared)

/** What the service gets; `undefined` while a number field holds something else. The name is not the panel's: it goes as it came. */
function formOf(values: Values, name: string | null, shared: SharedForm): ProjectForm | undefined {
  const text = (key: string) => values[key] as string
  const on = (key: string) => values[key] as boolean
  const slot = wholeOf(text('slot'), 0)
  const own = ownOf(values)
  if (own === undefined || slot === undefined) return undefined
  const trackerProject = text('trackerProject').trim()
  const labels = text('modelLabels')
  return {
    name,
    repo: text('repo').trim(),
    branch: text('branch').trim(),
    tracker: text('tracker'),
    trackerProject: trackerProject === '' ? null : trackerProject,
    slot,
    color: text('color') === '' ? null : Number(text('color')),
    brief: text('brief') === '' ? null : text('brief') === 'true',
    chain: rulesOf(values as Record<(typeof RULE_KEYS)[number], Value>),
    prompt: text('prompt').trim(),
    beforeStart: linesOf(text('beforeStart')),
    check: linesOf(text('check')),
    afterGreen: linesOf(text('afterGreen')),
    ci: {
      guard: ownOr(own, 'ci.guard', shared.ci.guard),
      kinds: ownOr(own, 'ci.kinds', shared.ci.kinds),
      waitMinutes: ownOr(own, 'ci.waitMinutes', shared.ci.waitMinutes),
      recheckMain: ownOr(own, 'ci.recheckMain', shared.ci.recheckMain),
      fixTask: ownOr(own, 'ci.fixTask', shared.ci.fixTask),
    },
    remoteProfiles: Object.fromEntries(CI_KINDS.flatMap((kind) => (text(remoteKey(kind)) === '' ? [] : [[kind, text(remoteKey(kind))]]))),
    pullRequests: on('pullRequests'),
    fillMilestone: ownOr(own, 'fillMilestone', shared.fillMilestone),
    changelog: text('changelog').trim(),
    provider: text('provider') === '' ? null : text('provider'),
    models: providerMap('models', values),
    accounts: providerMap('accounts', values),
    modelLabels: labels === '' ? null : labels === 'true',
    promptLanguage: ownOr(own, 'promptLanguage', shared.promptLanguage),
    cacheTtl: ownOr(own, 'cacheTtl', shared.cacheTtl),
    checkpointTokens: ownOr(own, 'stats.checkpointTokens', shared.stats.checkpointTokens),
    own,
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
  tasks,
  onClose,
}: {
  project: string
  form: ProjectForm
  config: ConfigView
  configError: Notice | null
  /** The project's tasks: their statuses and labels are offered in the chain rules. */
  tasks: readonly Task[]
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const { send, sending, failure } = useCommand()
  const { state } = useLive()
  const saved = valuesOf(form)
  const [current, setDraft] = useDraft(scopeOf(project), saved, same)
  const draft = current!
  const [open, setOpen] = useTab<GroupId>(scopeOf(project), 'repo')
  const projectId = state?.projectIds[project]
  const vocabularies = useVocabularies(projectId === undefined ? [] : [projectId])
  const dirty = (id: GroupId) => changed(draft, keysOf(id), same).length > 0
  const outgoing = sent(draft, keysOf(open))
  const shared = config.shared
  const next = formOf(outgoing.form, form.name, shared)
  const base = formOf(outgoing.base, form.name, shared)
  const locked = config.trackerLocked.includes(project)
  const errorOf = useFieldErrors(project, [failure, configError], config)
  const text = (key: string) => draft.edit[key] as string
  const on = (key: string) => draft.edit[key] as boolean
  const tracker = config.trackers.find((each) => each.name === text('tracker'))
  const kinds = draft.edit.kinds as readonly CiKind[]
  const offered = offeredProviders(state?.account ?? null, namedProviders(text, [config.shared.provider, text('provider')], ['models', 'accounts']))

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
  const unguarded = !(switchOf(text('guard')) ?? shared.ci.guard)
  const check = (key: string, label: string, hint: string, error?: string, disabled = false) => (
    <CheckField className={marks.box(key)} label={label} hint={hint} checked={on(key)} disabled={disabled} onChange={(checked) => edit(key, checked)}>
      {marks.note(key)}
      {error !== undefined && <FieldNote error={errorOf(error)} />}
    </CheckField>
  )

  const choice = (key: string, label: string, hint: string, options: { value: string; label: string }[], disabled = false) => (
    <div className={marks.box(key)}>
      <FieldHead label={label} hint={hint} htmlFor={fieldId(key)} />
      <Select
        id={fieldId(key)}
        className="settings__text settings__short"
        value={text(key)}
        options={options}
        invalid={errorOf(key) !== null}
        disabled={disabled}
        onChange={(value) => edit(key, value)}
      />
      {marks.note(key, (value) => options.find((option) => option.value === value)?.label ?? String(value))}
      <FieldNote error={errorOf(key)} />
    </div>
  )
  const onOff = (value: boolean) => (value ? t.settings.on : t.settings.off)
  const switchChoice = (key: string, label: string, hint: string, sharedValue: boolean, disabled = false) =>
    choice(
      key,
      label,
      hint,
      [
        { value: '', label: t.settings.asShared(onOff(sharedValue)) },
        { value: 'true', label: t.settings.on },
        { value: 'false', label: t.settings.off },
      ],
      disabled,
    )
  // A field the project may leave to the shared settings: unticked, it shows the shared value and cannot be edited.
  const ownToggle = (flag: string, key: string, sharedValue: Value, disabled = false) => (
    <label className="settings__check settings__own">
      <input
        type="checkbox"
        checked={on(flag)}
        disabled={disabled}
        onChange={(event) => setDraft(edited(edited(draft, flag, event.target.checked), key, event.target.checked ? sharedValue : saved[key]!))}
      />
      {t.settings.ownValue}
      {marks.note(flag)}
    </label>
  )
  const sharedWait = shared.ci.waitMinutes === null ? '' : String(shared.ci.waitMinutes)
  const sharedCheckpoint = shared.stats.checkpointTokens === null ? '' : String(shared.stats.checkpointTokens)
  const shownKinds = on('ownKinds') ? kinds : shared.ci.kinds
  const choices = remoteChoices(state?.profiles.profiles ?? [], state?.remotes[project] ?? [])
  // One profile on offer is no choice: the field shows only while there are two, or a choice was made.
  const remoteChoice = (kind: CiKind) => {
    const key = remoteKey(kind)
    const offered = choices[kind]
    const gone = text(key) !== '' && !offered.some((profile) => profile.id === text(key))
    if (offered.length < 2 && text(key) === '') return null
    const options = [
      { value: '', label: t.settings.remoteAuto },
      ...offered.map((profile) => ({ value: profile.id, label: profile.name })),
      ...(gone ? [{ value: text(key), label: t.settings.remoteGone }] : []),
    ]
    return <Fragment key={kind}>{choice(key, t.settings.remoteProfile(FORGES[kind]), t.settings.remoteProfileHint, options)}</Fragment>
  }

  const groups: Record<GroupId, () => ReactNode> = {
    repo: () => (
      <>
        <div className={marks.box('repo')}>
          <FieldHead label={t.settings.repo} hint={t.settings.repoHint} htmlFor={fieldId('repo')} />
          <input
            id={fieldId('repo')}
            className="settings__text settings__text--mono"
            spellCheck={false}
            value={text('repo')}
            aria-invalid={errorOf('repo') !== null}
            onChange={(event) => edit('repo', event.target.value)}
          />
          {marks.note('repo')}
          <FieldNote error={errorOf('repo')} />
        </div>
        <div className={marks.box('branch')}>
          <FieldHead label={t.settings.branch} hint={t.settings.branchHint} htmlFor={fieldId('branch')} />
          <input
            id={fieldId('branch')}
            className="settings__text settings__text--mono settings__short"
            spellCheck={false}
            value={text('branch')}
            placeholder="main"
            aria-invalid={errorOf('branch') !== null}
            onChange={(event) => edit('branch', event.target.value)}
          />
          {marks.note('branch')}
          <FieldNote error={errorOf('branch')} />
        </div>
        <div className={marks.box('slot')}>
          <FieldHead label={t.settings.slot} hint={t.settings.slotHint} htmlFor={fieldId('slot')} />
          <input
            id={fieldId('slot')}
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
        </div>
        <div className={marks.box('changelog')}>
          <FieldHead label={t.settings.changelog} hint={t.settings.changelogHint} htmlFor={fieldId('changelog')} />
          <input
            id={fieldId('changelog')}
            className="settings__text settings__text--mono"
            spellCheck={false}
            value={text('changelog')}
            placeholder="CHANGELOG.md"
            aria-invalid={errorOf('changelog') !== null}
            onChange={(event) => edit('changelog', event.target.value)}
          />
          {marks.note('changelog')}
          <FieldNote error={errorOf('changelog')} />
        </div>
        <div className={marks.box('color')}>
          <FieldHead label={t.settings.color} hint={t.settings.colorHint} />
          <div className="settings__colors" role="radiogroup" aria-label={t.settings.color}>
            {Array.from({ length: PROJECT_SLOTS }, (_, index) => String(index + 1)).map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={text('color') === color}
                aria-label={t.settings.colorSlot(Number(color))}
                className={text('color') === color ? 'settings__color settings__color--on' : 'settings__color'}
                style={seriesStyle(Number(color))}
                onClick={() => edit('color', color)}
              />
            ))}
          </div>
          {marks.note('color')}
          <FieldNote error={errorOf('color')} />
        </div>
        <ProjectRemove project={project} />
      </>
    ),
    tracker: () => (
      <>
        <div className="settings__row">
          <div className={marks.box('tracker')}>
            <FieldHead label={t.settings.tracker} htmlFor={fieldId('tracker')} soon={locked ? t.settings.trackerSoon : undefined} />
            <Select
              id={fieldId('tracker')}
              className="settings__text settings__short"
              value={text('tracker')}
              options={config.trackers.map((each) => ({ value: each.name, label: each.title }))}
              invalid={errorOf('tracker') !== null}
              disabled={locked}
              onChange={(value) => edit('tracker', value)}
            />
            {marks.note('tracker')}
            <FieldNote error={errorOf('tracker')} />
          </div>
          {state !== null && <ProfileLink id={fieldId('profile')} state={state} project={project} />}
          {tracker?.projectKey != null && (
            <div className={marks.box('trackerProject', 'settings__field settings__grow')}>
              <FieldHead
                label={t.settings.trackerProject(tracker.name, tracker.title)}
                hint={tracker.projectKey.optional ? t.settings.trackerProjectOptional : undefined}
                htmlFor={fieldId('trackerProject')}
              />
              <input
                id={fieldId('trackerProject')}
                className="settings__text settings__text--mono"
                spellCheck={false}
                value={text('trackerProject')}
                placeholder={tracker.projectKey.example}
                aria-invalid={errorOf('trackerProject') !== null}
                disabled={locked}
                onChange={(event) => edit('trackerProject', event.target.value)}
              />
              {marks.note('trackerProject')}
              <FieldNote error={errorOf('trackerProject')} />
            </div>
          )}
        </div>
        {locked && <p className="settings__hint">{t.settings.trackerLocked}</p>}
        {switchChoice('fillMilestone', t.settings.fillMilestone, t.settings.fillMilestoneHint, shared.fillMilestone)}
        <RuleFields text={text} onEdit={edit} errorOf={errorOf} marks={marks} choices={ruleChoicesOf(tasks, vocabularies)} />
      </>
    ),
    sessions: () => (
      <>
        {choice('provider', t.settings.provider, t.settings.providerHint, [
          { value: '', label: t.settings.asShared(providerName(config.shared.provider)) },
          ...providerOptions(offered),
        ])}
        <ProviderGrid
          columns={[
            { key: 'models', label: t.settings.model, hint: t.settings.modelHint },
            { key: 'accounts', label: t.settings.account, hint: t.settings.accountHint },
          ]}
          providers={offered}
          cell={(column, provider) => {
            const key = `${column}.${provider}`
            if (column === 'accounts') {
              const options = [
                { value: '', label: t.settings.asShared(config.shared.accounts[provider] ?? '—') },
                ...(state === null ? [] : accountOptions(state.account, provider, text(key))),
              ]
              return (
                <div className={marks.box(key)}>
                  <Select
                    id={fieldId(key)}
                    className="settings__text"
                    label={t.settings.accountOf(providerName(provider))}
                    value={text(key)}
                    options={options}
                    invalid={errorOf(key) !== null}
                    onChange={(value) => edit(key, value)}
                  />
                  {marks.note(key, (value) => options.find((option) => option.value === value)?.label ?? String(value))}
                  <FieldNote error={errorOf(key)} />
                </div>
              )
            }
            return (
              <div className={marks.box(key)}>
                <input
                  id={fieldId(key)}
                  className="settings__text settings__text--mono"
                  aria-label={t.settings.modelOf(providerName(provider))}
                  spellCheck={false}
                  value={text(key)}
                  placeholder={t.settings.asShared(config.shared.models[provider] ?? t.settings.cliDefault)}
                  aria-invalid={errorOf(key) !== null}
                  onChange={(event) => edit(key, event.target.value)}
                />
                {marks.note(key)}
                <FieldNote error={errorOf(key)} />
              </div>
            )
          }}
        />
        {choice('modelLabels', t.settings.modelLabels, t.settings.modelLabelsHint, [
          { value: '', label: t.settings.asShared(config.shared.modelLabels ? t.settings.on : t.settings.off) },
          { value: 'true', label: t.settings.on },
          { value: 'false', label: t.settings.off },
        ])}
        {choice('brief', t.settings.brief, t.settings.briefHint, [
          { value: '', label: t.settings.briefAuto },
          { value: 'true', label: t.settings.on },
          { value: 'false', label: t.settings.off },
        ])}
        <div className={marks.box('prompt')}>
          <FieldHead label={t.settings.prompt} hint={t.settings.promptHint} htmlFor={fieldId('prompt')} />
          <textarea
            id={fieldId('prompt')}
            className="settings__text"
            rows={5}
            value={text('prompt')}
            placeholder={t.settings.promptPlaceholder}
            onChange={(event) => edit('prompt', event.target.value)}
          />
          {marks.note('prompt')}
          <FieldNote error={errorOf('prompt')} />
        </div>
        <div className={marks.box('beforeStart')}>
          <FieldHead label={t.settings.beforeStart} hint={t.settings.beforeStartHint} htmlFor={fieldId('beforeStart')} />
          <textarea
            id={fieldId('beforeStart')}
            className="settings__text settings__text--mono"
            rows={4}
            spellCheck={false}
            value={text('beforeStart')}
            placeholder={t.settings.beforeStartPlaceholder}
            onChange={(event) => edit('beforeStart', event.target.value)}
          />
          {marks.note('beforeStart')}
          <FieldNote error={errorOf('beforeStart')} />
        </div>
        {choice('promptLanguage', t.shared.promptLanguage, t.settings.promptLanguageHint, [
          { value: '', label: t.settings.asShared(t.shared.languages[shared.promptLanguage]) },
          ...LANGUAGES.map((language) => ({ value: language, label: t.shared.languages[language] })),
        ])}
        {choice('cacheTtl', t.shared.cacheTtl, t.shared.cacheTtlHint, [
          { value: '', label: t.settings.asShared(ttlLabel(shared.cacheTtl)) },
          { value: CLI_TTL, label: t.shared.cacheTtlAuto },
          { value: '5m', label: t.shared.cacheTtl5m },
          { value: '1h', label: t.shared.cacheTtl1h },
        ])}
        <div className={marks.box(['ownCheckpoint', 'checkpointTokens'])}>
          <FieldHead label={t.shared.checkpointTokens} hint={t.shared.checkpointTokensHint} htmlFor={fieldId('checkpointTokens')} />
          {ownToggle('ownCheckpoint', 'checkpointTokens', sharedCheckpoint)}
          <input
            id={fieldId('checkpointTokens')}
            className="settings__text settings__number"
            inputMode="numeric"
            value={on('ownCheckpoint') ? text('checkpointTokens') : sharedCheckpoint}
            placeholder={t.shared.checkpointTokensPlaceholder}
            disabled={!on('ownCheckpoint')}
            aria-invalid={on('ownCheckpoint') && tokensOf(text('checkpointTokens')) === undefined}
            onChange={(event) => edit('checkpointTokens', event.target.value)}
          />
          {marks.note('checkpointTokens', (value) => ((value as string).trim() === '' ? t.shared.checkpointTokensPlaceholder : (value as string)))}
          <FieldNote error={errorOf('stats.checkpointTokens')} />
        </div>
      </>
    ),
    ci: () => (
      <>
        {switchChoice('guard', t.settings.guard, t.settings.guardHint, shared.ci.guard)}
        {/* With the guard off the values stay as they are, only greyed out: turning it back on brings them back. */}
        <div className={unguarded ? 'settings__guarded settings__guarded--off' : 'settings__guarded'}>
          <div className={marks.box('check')}>
            <FieldHead label={t.settings.check} hint={t.settings.checkHint} htmlFor={fieldId('check')} />
            <textarea
              id={fieldId('check')}
              className="settings__text settings__text--mono"
              rows={3}
              spellCheck={false}
              value={text('check')}
              placeholder={t.settings.checkPlaceholder}
              disabled={unguarded}
              onChange={(event) => edit('check', event.target.value)}
            />
            {marks.note('check')}
            <FieldNote error={errorOf('check')} />
          </div>
          <div className={marks.box('afterGreen')}>
            <FieldHead label={t.settings.afterGreen} hint={t.settings.afterGreenHint} htmlFor={fieldId('afterGreen')} />
            <textarea
              id={fieldId('afterGreen')}
              className="settings__text settings__text--mono"
              rows={3}
              spellCheck={false}
              value={text('afterGreen')}
              placeholder={t.settings.afterGreenPlaceholder}
              disabled={unguarded}
              onChange={(event) => edit('afterGreen', event.target.value)}
            />
            {marks.note('afterGreen')}
            <FieldNote error={errorOf('afterGreen')} />
          </div>
          <fieldset className={marks.box(['ownKinds', 'kinds'], 'settings__field settings__group')}>
            <legend>
              <FieldHead label={t.settings.ci} hint={t.settings.ciHint} />
            </legend>
            {ownToggle('ownKinds', 'kinds', shared.ci.kinds, unguarded)}
            <div className="settings__checks">
              {CI_KINDS.map((kind) => (
                <label key={kind} className="settings__check">
                  <input
                    type="checkbox"
                    checked={shownKinds.includes(kind)}
                    disabled={unguarded || !on('ownKinds')}
                    onChange={(event) => toggle(kind, event.target.checked)}
                  />
                  {t.settings.ciKinds[kind]}
                </label>
              ))}
            </div>
            {marks.note('kinds', (value) => shown((value as CiKind[]).map((kind) => t.settings.ciKinds[kind])))}
            <FieldNote error={errorOf('ci')} />
          </fieldset>
          <div className={marks.box(['ownWait', 'wait'])}>
            <FieldHead label={t.settings.ciWait} hint={t.settings.ciWaitHint} htmlFor={fieldId('wait')} />
            {ownToggle('ownWait', 'wait', sharedWait, unguarded)}
            <input
              id={fieldId('wait')}
              className="settings__text settings__number"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={on('ownWait') ? text('wait') : sharedWait}
              placeholder={t.settings.ciWaitPlaceholder}
              disabled={unguarded || !on('ownWait')}
              aria-invalid={on('ownWait') && minutesOf(text('wait')) === undefined}
              onChange={(event) => edit('wait', event.target.value)}
            />
            {marks.note('wait', (value) => ((value as string).trim() === '' ? t.settings.ciWaitPlaceholder : shown(value)))}
          </div>
          {switchChoice('recheck', t.settings.recheckMain, t.settings.recheckMainHint, shared.ci.recheckMain, unguarded)}
          {switchChoice('fixTask', t.settings.fixTask, t.settings.fixTaskHint, shared.ci.fixTask, unguarded)}
        </div>
        {check('pullRequests', t.settings.pullRequests, t.settings.pullRequestsHint, 'pullRequests')}
        {CI_KINDS.map(remoteChoice)}
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
