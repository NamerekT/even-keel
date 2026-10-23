import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import { CI_KINDS, type CiKind } from '../../../src/ci/model.js'
import type { Notice } from '../../../src/notice/notice.js'
import type { ChainRules } from '../../../src/chain/rules.js'
import type { CacheTtl, ConfigView, ProjectForm } from '../../../src/state.js'
import { LANGUAGES } from '../../../src/language.js'
import type { Task } from '../../../src/tracker/model.js'
import { offeredProviders } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { PROJECT_SLOTS, projectLabel } from '../state.js'
import { SlidersIcon } from '../ui/icons.js'
import { Select } from '../ui/Select.js'
import { seriesStyle } from '../ui/series.js'
import { changed, edited, reverted, sent, type Value, type Values } from './settingsDraft.js'
import { accountOptions, namedProviders, providerKeys, providerName, providerOptions } from './settingsRun.js'
import {
  CheckField,
  FieldHead,
  fieldId,
  FieldNote,
  GroupTabs,
  marksOf,
  minutesOf,
  ProviderGrid,
  RULE_KEYS,
  HelpTip,
  type RuleKey,
  rulesOf,
  sameBy,
  SaveBar,
  SHARE_KEYS,
  shareOf,
  sharesText,
  shown,
  unplaced,
  UnsavedDot,
  useFieldErrors,
  wholeOf,
} from './settingsParts.js'
import { ruleChoicesOf } from './settingsRows.js'
import { useVocabularies } from './useVocabularies.js'
import { ProjectRemove } from './ProjectRemove.js'
import { CLI_TTL, formOf, profileOf, remoteKey, switchOf, tokensOf, valuesOf } from './projectForm.js'
import { ProjectTracker } from './ProjectTracker.js'
import { effectiveRules, knownStatuses, ruleOrigins } from './ruleRows.js'
import { MilestoneFields, RuleForm, ruleText } from './RuleForm.js'
import { FeedList } from './FeedList.js'
import { TrackerPackageButton } from './ToolsLink.js'
import { remoteChoices } from './remoteProfiles.js'
import { projectScope as scopeOf, useDraft, useTab } from './settingsStore.js'
import { SEG_CLASS, type ChipLook } from './chipLook.js'
import { AddPullProfile, PullHint } from './PullButtons.js'
import { FORGES } from '../../../src/notice/en.js'
import './settings.css'

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

// Related fields share a group, so a save of one group never leaves another half-agreeing with it.
const GROUPS = [
  { id: 'repo', keys: ['repo', 'branch', 'mergeInto', 'slot', 'changelog', 'color'] },
  { id: 'tracker', keys: ['tracker', 'trackerProject', 'fillMilestone', 'intakeLabel', ...RULE_KEYS] },
  {
    id: 'sessions',
    keys: ['provider', ...providerKeys('models'), ...providerKeys('accounts'), 'modelLabels', 'brief', 'prompt', 'beforeStart', 'promptLanguage', 'cacheTtl', 'ownCheckpoint', 'checkpointTokens', 'ownShares', ...SHARE_KEYS],
  },
  { id: 'ci', keys: ['guard', 'check', 'afterGreen', 'ownKinds', 'kinds', 'ownWait', 'wait', 'recheck', 'fixTask', 'pullRequests', ...CI_KINDS.map(remoteKey)] },
] as const
type GroupId = (typeof GROUPS)[number]['id']
const KEYS: readonly string[] = GROUPS.flatMap((group) => group.keys)
const keysOf = (id: GroupId): readonly string[] => GROUPS.find((group) => group.id === id)!.keys
const same = sameBy(['beforeStart', 'check', 'afterGreen', ...RULE_KEYS])

const ttlLabel = (ttl: CacheTtl | null) => (ttl === null ? t.shared.cacheTtlAuto : ttl === '5m' ? t.shared.cacheTtl5m : t.shared.cacheTtl1h)

/** Whether a group of the project's settings holds changes nobody saved yet: the Settings tab shows it even with the panel closed. */
export function useSettingsDirty(project: string, form: ProjectForm | undefined): boolean {
  const { state } = useLive()
  const [draft] = useDraft(scopeOf(project), form === undefined ? undefined : valuesOf(form, profileOf(state, project, form.tracker)?.rules ?? {}), same)
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
  const profile = profileOf(state, project, form.tracker)
  const profileRules: Partial<ChainRules> = profile?.rules ?? {}
  const saved = valuesOf(form, profileRules)
  const [current, setDraft] = useDraft(scopeOf(project), saved, same)
  const draft = current!
  const [open, setOpen] = useTab<GroupId>(scopeOf(project), 'repo')
  const vocabularies = useVocabularies(state?.projects.includes(project) === true ? [project] : [])
  const dirty = (id: GroupId) => changed(draft, keysOf(id), same).length > 0
  const outgoing = sent(draft, keysOf(open))
  const shared = config.shared
  const next = formOf(outgoing.form, form.name, shared)
  const base = formOf(outgoing.base, form.name, shared)
  const locked = config.trackerLocked.includes(project)
  const errorOf = useFieldErrors(project, [failure, configError], config)
  const text = (key: string) => draft.edit[key] as string
  const on = (key: string) => draft.edit[key] as boolean
  const kinds = draft.edit.kinds as readonly CiKind[]
  // Only turning PR mode on waits for a remote and its profile (EKR-7): one already on stays free to turn off.
  const pullReadiness = state?.pullReadiness[project] ?? null
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
  const editAll = (changes: [string, Value][]) => setDraft(changes.reduce((each, [key, value]) => edited(each, key, value), draft))
  const chain = rulesOf(draft.edit as Record<RuleKey, Value>)
  const inherited = effectiveRules(shared.chain, [], profileRules)
  const origins = ruleOrigins(chain, inherited, profileRules)
  const ruleChoices = ruleChoicesOf(tasks, vocabularies)
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

  const choice = (key: string, label: string, hint: string, options: { value: string; label: string }[], disabled = false, beside?: ReactNode) => (
    <div className={marks.box(key)}>
      <FieldHead label={label} hint={hint} htmlFor={fieldId(key)} />
      <div className="settings__beside">
        <Select
          id={fieldId(key)}
          className="settings__text settings__short"
          value={text(key)}
          options={options}
          invalid={errorOf(key) !== null}
          disabled={disabled}
          onChange={(value) => edit(key, value)}
        />
        {beside}
      </div>
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
  // Fields the project may leave to the shared settings: unticked, they show the shared values and cannot be edited.
  const ownToggle = (flag: string, sharedValues: Values, disabled = false) => (
    <label className="settings__check settings__own">
      <input
        type="checkbox"
        checked={on(flag)}
        disabled={disabled}
        onChange={(event) => {
          const own = event.target.checked
          const fields = Object.entries(sharedValues)
          setDraft(fields.reduce((next, [key, value]) => edited(next, key, own ? value : saved[key]!), edited(draft, flag, own)))
        }}
      />
      {t.settings.ownValue}
      {marks.note(flag)}
    </label>
  )
  const sharedWait = shared.ci.waitMinutes === null ? '' : String(shared.ci.waitMinutes)
  const sharedCheckpoint = shared.stats.checkpointTokens === null ? '' : String(shared.stats.checkpointTokens)
  const sharedShares = sharesText(shared.stats.checkpointShares)
  const shownKinds = on('ownKinds') ? kinds : shared.ci.kinds
  const choices = remoteChoices(state?.profiles.profiles ?? [], state?.remotes[project] ?? [])
  // A release project merges into a main one of its own repository, never into another release project. Until the
  // remotes are read, every main project is offered: the save checks it.
  const kin = state?.sameRepository[project]
  const mainProjects = Object.entries(config.projects).flatMap(([key, each]) =>
    key !== project && each.mergeInto === null && (kin === undefined || kin.includes(key)) ? [key] : [],
  )
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
        {choice('mergeInto', t.settings.mergeInto, t.settings.mergeIntoHint, [
          { value: '', label: t.settings.mergeIntoNone },
          ...mainProjects.map((key) => ({ value: key, label: projectLabel(state, key) })),
          ...(text('mergeInto') !== '' && !mainProjects.includes(text('mergeInto'))
            ? [{ value: text('mergeInto'), label: projectLabel(state, text('mergeInto')) }]
            : []),
        ])}
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
        {state !== null && (
          <ProjectTracker
            state={state}
            project={project}
            tracker={text('tracker')}
            trackerProject={text('trackerProject')}
            locked={locked}
            trackerNote={
              <>
                {marks.note('tracker')}
                <FieldNote error={errorOf('tracker')} />
              </>
            }
            box={marks.box('trackerProject')}
            note={
              <>
                {marks.note('trackerProject')}
                <FieldNote error={errorOf('trackerProject')} />
              </>
            }
            invalid={errorOf('trackerProject') !== null}
            onEdit={(tracker, value) =>
              setDraft(
                tracker === text('tracker')
                  ? edited(draft, 'trackerProject', value)
                  : tracker === saved.tracker
                    ? reverted(draft, saved, ['tracker', 'trackerProject'])
                    : edited(edited(draft, 'tracker', tracker), 'trackerProject', ''),
              )
            }
          />
        )}
        <MilestoneFields
          level="project"
          rules={chain}
          inherited={inherited}
          origins={origins}
          milestones={ruleChoices.milestones}
          text={text}
          onEdit={editAll}
          errorOf={errorOf}
          marks={marks}
        />
        {state !== null && <FeedList state={state} project={project} />}
        {switchChoice('fillMilestone', t.settings.fillMilestone, t.settings.fillMilestoneHint, shared.fillMilestone)}
        {text('tracker') !== 'github' && (
          <div className={marks.box('intakeLabel')}>
            <FieldHead label={t.settings.intakeLabel} hint={t.settings.intakeLabelHint} htmlFor={fieldId('intakeLabel')} />
            <input
              id={fieldId('intakeLabel')}
              className="settings__text settings__text--mono tracker-fields__wide"
              spellCheck={false}
              value={text('intakeLabel')}
              placeholder={t.settings.intakeLabelNone}
              aria-invalid={errorOf('intakeLabel') !== null}
              onChange={(event) => edit('intakeLabel', event.target.value)}
            />
            {marks.note('intakeLabel')}
            <FieldNote error={errorOf('intakeLabel')} />
          </div>
        )}
        <RuleForm
          level="project"
          rules={chain}
          inherited={inherited}
          origins={origins}
          profileName={profile?.name ?? null}
          statuses={knownStatuses(
            vocabularies.map((each) => each.statuses),
            tasks.map((task) => task.status),
            chain,
          )}
          labels={ruleChoices.labels}
          modelLabels={text('modelLabels') === '' ? shared.modelLabels : text('modelLabels') === 'true'}
          onEdit={(changes) => editAll(changes.map(([key, value]) => [key, ruleText(value)]))}
          errorOf={errorOf}
          marks={marks}
        />
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
        {choice(
          'brief',
          t.settings.brief,
          t.settings.briefHint,
          [
            { value: '', label: t.settings.briefAuto },
            { value: 'true', label: t.settings.on },
            { value: 'false', label: t.settings.off },
          ],
          false,
          state !== null && <TrackerPackageButton project={project} packages={state.packages} />,
        )}
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
        <div className={marks.box(['ownCheckpoint', 'checkpointTokens'])}>
          <FieldHead label={t.shared.checkpointTokens} hint={t.shared.checkpointTokensHint} htmlFor={fieldId('checkpointTokens')} />
          {ownToggle('ownCheckpoint', { checkpointTokens: sharedCheckpoint })}
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
        <div className={marks.box('ownShares')}>
          <FieldHead label={t.shared.checkpointShares} hint={t.shared.checkpointSharesHint} />
          {ownToggle('ownShares', sharedShares)}
          <div className="settings__row">
            {SHARE_KEYS.map((key) => (
              <div key={key} className={marks.box(key)}>
                <FieldHead label={t.shared[key]} htmlFor={fieldId(key)} />
                <input
                  id={fieldId(key)}
                  className="settings__text settings__number"
                  inputMode="numeric"
                  value={on('ownShares') ? text(key) : sharedShares[key]}
                  disabled={!on('ownShares')}
                  aria-invalid={on('ownShares') && shareOf(text(key)) === undefined}
                  onChange={(event) => edit(key, event.target.value)}
                />
                {marks.note(key)}
              </div>
            ))}
          </div>
          <FieldNote error={errorOf('checkpointShares')} />
        </div>
        <fieldset className="settings__field settings__group">
          <legend className="settings__subgroup">{t.shared.claude}</legend>
          {choice('cacheTtl', t.shared.cacheTtl, t.shared.cacheTtlHint, [
            { value: '', label: t.settings.asShared(ttlLabel(shared.cacheTtl)) },
            { value: CLI_TTL, label: t.shared.cacheTtlAuto },
            { value: '5m', label: t.shared.cacheTtl5m },
            { value: '1h', label: t.shared.cacheTtl1h },
          ])}
        </fieldset>
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
            {ownToggle('ownKinds', { kinds: shared.ci.kinds }, unguarded)}
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
            {ownToggle('ownWait', { wait: sharedWait }, unguarded)}
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
        <CheckField
          className={marks.box('pullRequests')}
          label={t.settings.pullRequests}
          hint={t.settings.pullRequestsHint}
          checked={on('pullRequests')}
          disabled={pullReadiness !== null && !on('pullRequests') && saved.pullRequests !== true}
          onChange={(checked) => edit('pullRequests', checked)}
        >
          <span className="settings__beside">
            <AddPullProfile readiness={pullReadiness} />
            <PullHint readiness={pullReadiness} on={on('pullRequests')} />
          </span>
          {marks.note('pullRequests')}
          <FieldNote error={errorOf('pullRequests')} />
        </CheckField>
        {CI_KINDS.map(remoteChoice)}
      </>
    ),
  }

  return (
    <aside className="panel settings" aria-label={t.settings.title}>
      <header className="panel__head settings__head">
        <GroupTabs groups={GROUPS.map(({ id }) => ({ id, title: t.settings.groups[id] }))} open={open} dirty={dirty} onOpen={setOpen} />
        <HelpTip text={t.settings.hint} align="end" />
        <button ref={closeRef} type="button" className="panel__close" aria-label={t.session.closePanel} onClick={onClose}>
          ×
        </button>
      </header>
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
        <SaveBar shown={dirty(open)} canSave={!sending && next !== undefined} onRevert={() => revert(keysOf(open))} />
      </form>
    </aside>
  )
}
