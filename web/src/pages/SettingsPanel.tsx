import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_PROTECTION } from '../../../src/sessions/protection.js'
import { ProtectionSettings } from './ProtectionSettings.js'
import { CI_KINDS, type CiKind } from '../../../src/ci/model.js'
import { CLAUDE } from '../../../src/claude/name.js'
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
import { Select } from '../ui/Select.js'
import { seriesStyle } from '../ui/series.js'
import { changed, edited, reverted, sent, type Value, type Values } from './settingsDraft.js'
import { folderLabel } from '../accountName.js'
import { accountOptions, namedProviders, pickedProvider, providerKeys, providerName } from './settingsRun.js'
import { ProviderChoices } from './ProviderChoices.js'
import {
  FieldHead,
  fieldId,
  FieldNote,
  GroupTabs,
  Inherit,
  type Inheritance,
  marksOf,
  minutesOf,
  Row,
  RULE_KEYS,
  type RuleKey,
  rulesOf,
  rulesText,
  sameBy,
  SaveBar,
  Section,
  SHARE_KEYS,
  shareOf,
  sharesText,
  shown,
  SwitchField,
  unplaced,
  useFieldErrors,
  wholeOf,
} from './settingsParts.js'
import { ruleChoicesOf, sourceTasks } from './settingsRows.js'
import { SourceDialog, SourceLine } from './SourceDialog.js'
import { useSourceMoves } from './SourceMoves.js'
import { Band } from '../ui/blocks.js'
import { useVocabularies } from './useVocabularies.js'
import { ModelOffers } from './ModelOffers.js'
import { TrustWarning } from './TrustCommands.js'
import { offersOf, useModelCatalog } from './useModels.js'
import { useModelReset } from './modelReset.js'
import { ProjectRemove } from './ProjectRemove.js'
import { SessionGets } from './SessionGets.js'
import { CLI_TTL, compactWindowOf, formOf, profileOf, remoteKey, standardRows, switchOf, tokensOf, valuesOf } from './projectForm.js'
import { ProjectStandards } from './ProjectStandards.js'
import { ProjectTracker } from './ProjectTracker.js'
import { effectiveRules, knownStatuses, ruleOrigins } from './ruleRows.js'
import { MilestoneFields, RuleForm, ruleText } from './RuleForm.js'
import { FeedList } from './FeedList.js'
import { TrackerPackageButton } from './ToolsLink.js'
import { remoteChoices } from './remoteProfiles.js'
import { projectScope as scopeOf, useDraft, useTab } from './settingsStore.js'
import { AddPullProfile, PullHint } from './PullButtons.js'
import { FORGES } from '../../../src/notice/en.js'
import './settings.css'

// Related fields share a group, so a save of one group never leaves another half-agreeing with it.
const GROUPS = [
  { id: 'repo', keys: ['repo', 'branch', 'mergeInto', 'carryAgent', 'slot', 'changelog', 'color'] },
  { id: 'tracker', keys: ['tracker', 'trackerProject', 'fillMilestone', 'intakeLabel', ...RULE_KEYS] },
  {
    id: 'sessions',
    keys: ['protection', 'provider', ...providerKeys('models'), ...providerKeys('accounts'), 'modelLabels', 'brief', 'prompt', 'beforeStart', 'promptLanguage', 'standards', 'cacheTtl', 'ownAutoCompact', 'autoCompactWindow', 'contextHandoffs', 'ownCheckpoint', 'checkpointTokens', 'ownShares', ...SHARE_KEYS],
  },
  { id: 'ci', keys: ['guard', 'check', 'afterGreen', 'ownKinds', 'kinds', 'ownWait', 'wait', 'recheck', 'fixTask', 'pullRequests', ...CI_KINDS.map(remoteKey)] },
] as const
type GroupId = (typeof GROUPS)[number]['id']
const KEYS: readonly string[] = GROUPS.flatMap((group) => group.keys)
const keysOf = (id: GroupId): readonly string[] => GROUPS.find((group) => group.id === id)!.keys
const same = sameBy(['beforeStart', 'check', 'afterGreen', ...RULE_KEYS])
const STATUS_KEYS: readonly RuleKey[] = ['active', 'terminal']

const ttlLabel = (ttl: CacheTtl | null) => (ttl === null ? t.shared.cacheTtlAuto : ttl === '5m' ? t.shared.cacheTtl5m : t.shared.cacheTtl1h)
const onOff = (value: boolean) => (value ? t.settings.on : t.settings.off)
const standardsShown = (value: Value) => shown(standardRows(value as string).map((row) => row.doc || '—'))
type Option = { value: string; label: string }
const labelOf = (options: readonly Option[]) => (value: Value) => options.find((option) => option.value === value)?.label ?? String(value)

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
  // Only turning PR mode on waits for a remote and its profile (EKR-7): one already on stays free to turn off.
  const pullReadiness = state?.pullReadiness[project] ?? null
  const offered = offeredProviders(state?.account ?? null, namedProviders(text, [config.shared.provider, text('provider')], ['models', 'accounts']))
  // The model is offered from the account its row runs on: the project's own, else the shared one.
  const rowAccount = (provider: string) => text(`accounts.${provider}`) || (config.shared.accounts[provider] ?? '')
  const models = useModelCatalog(offered.map(rowAccount))
  // Claude takes the project's tasks as its agent, or any task by its run label (BTN-429): the form's values, not the saved ones.
  const mayRunClaude = (text('provider') || shared.provider) === CLAUDE || (switchOf(text('modelLabels')) ?? shared.modelLabels)

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
  useModelReset(
    offered.map((provider) => ({ provider, choice: text(`accounts.${provider}`), account: rowAccount(provider), model: text(`models.${provider}`) })),
    models,
    (providers) => editAll(providers.map((provider) => [`models.${provider}`, ''])),
  )
  const chain = rulesOf(draft.edit as Record<RuleKey, Value>)
  // The rules inherit from the profile of the tracker the draft has: a tracker changed and not saved yet brings its own.
  const ruleProfile = profileOf(state, project, text('tracker'))
  const inheritedOf = (tracker: string) => effectiveRules(shared.chain, [], profileOf(state, project, tracker)?.rules ?? {})
  const inherited = inheritedOf(text('tracker'))
  const origins = ruleOrigins(chain, inherited, ruleProfile?.rules ?? {})
  // The main tracker's tasks only: a feed's are offered in its own window (BTN-553).
  const mainTasks = sourceTasks(tasks, config.feeds[project] ?? [], null)
  const ruleChoices = ruleChoicesOf(mainTasks, vocabularies)
  // Another tracker names other statuses: the project's own status lists go back to what the new one inherits, saved with it.
  const statusesOf = (tracker: string): [string, Value][] => STATUS_KEYS.map((key) => [key, rulesText(inheritedOf(tracker))[key]])
  const statusesReset = text('tracker') !== saved.tracker && form.ownRules.some((key) => STATUS_KEYS.includes(key))
  const trackerTitle = config.trackers.find((each) => each.name === text('tracker'))?.title ?? text('tracker')
  const [configuring, setConfiguring] = useState(false)
  const moves = useSourceMoves({ state, project, feed: null, kind: text('tracker'), profile: ruleProfile, rules: chain, saved: form.moves })
  const revert = (keys: readonly string[]) => setDraft(reverted(draft, saved, keys))
  const marks = marksOf(draft, saved, same, revert)
  const save = async () => {
    if (next === undefined || base === undefined) return false
    return send('project/settings', { project, ...next, base })
  }
  const leftover = unplaced(project, failure, config)
  const unguarded = !(switchOf(text('guard')) ?? shared.ci.guard)

  // A key whose '' is "as shared": the field shows the shared value under a chip until an edit makes it the project's own.
  const inheritOf = (key: string, sharedLabel: string, disabled = false): Inheritance => ({ own: text(key) !== '', shared: sharedLabel, disabled, onReset: () => edit(key, '') })
  const notes = (key: string, show?: (value: Value) => string) => (
    <>
      {marks.note(key, show)}
      <FieldNote error={errorOf(key)} />
    </>
  )
  const pick = (key: string, label: string, hint: string, options: Option[], inherit?: { value: string; label: string }) => (
    <Row
      className={marks.box(key)}
      label={label}
      hint={hint}
      htmlFor={fieldId(key)}
      inherit={inherit === undefined ? undefined : inheritOf(key, inherit.label)}
      control={
        <Select
          id={fieldId(key)}
          className="settings__text"
          value={inherit === undefined || text(key) !== '' ? text(key) : inherit.value}
          options={options}
          invalid={errorOf(key) !== null}
          onChange={(value) => edit(key, value)}
        />
      }
    >
      {notes(key, (value) => (inherit !== undefined && value === '' ? t.settings.asShared(inherit.label) : labelOf(options)(value)))}
    </Row>
  )
  const inheritedSwitch = (key: string, label: string, hint: string, sharedValue: boolean, disabled = false) => (
    <SwitchField
      className={marks.box(key)}
      label={label}
      hint={hint}
      checked={switchOf(text(key)) ?? sharedValue}
      disabled={disabled}
      inherit={inheritOf(key, onOff(sharedValue), disabled)}
      onChange={(checked) => edit(key, String(checked))}
    >
      {notes(key, (value) => (value === '' ? t.settings.asShared(onOff(sharedValue)) : onOff(value === 'true')))}
    </SwitchField>
  )
  const input = (key: string, label: string, hint: string, placeholder?: string, mono = true) => (
    <Row
      className={marks.box(key)}
      label={label}
      hint={hint}
      htmlFor={fieldId(key)}
      control={
        <input
          id={fieldId(key)}
          className={mono ? 'settings__text settings__text--mono' : 'settings__text'}
          spellCheck={false}
          value={text(key)}
          placeholder={placeholder}
          aria-invalid={errorOf(key) !== null}
          onChange={(event) => edit(key, event.target.value)}
        />
      }
    >
      {notes(key)}
    </Row>
  )
  const lines = (key: string, label: string, hint: string, placeholder: string, rows: number, mono = true, disabled = false) => (
    <div className={marks.box(key)}>
      <FieldHead label={label} hint={hint} htmlFor={fieldId(key)} />
      <textarea
        id={fieldId(key)}
        className={mono ? 'settings__text settings__text--mono' : 'settings__text'}
        rows={rows}
        spellCheck={!mono}
        value={text(key)}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => edit(key, event.target.value)}
      />
      {notes(key)}
    </div>
  )

  // Fields kept own by a flag: they show the shared values until an edit turns the flag on with the shared values as the start.
  const ownEdit = (flag: string, sharedValues: Values) => (key: string, value: Value) => {
    const own = on(flag) ? draft : Object.entries(sharedValues).reduce((each, [field, shared]) => edited(each, field, shared), edited(draft, flag, true))
    setDraft(edited(own, key, value))
  }
  const ownInherit = (flag: string, sharedValues: Values, sharedLabel: string, disabled = false): Inheritance => ({
    own: on(flag),
    shared: sharedLabel,
    disabled,
    onReset: () => setDraft(Object.keys(sharedValues).reduce((each, field) => edited(each, field, saved[field]!), edited(draft, flag, false))),
  })
  const flagNote = (flag: string) => marks.note(flag, (value) => (value === true ? t.settings.ownChip : t.settings.sharedChip))
  const sharedWait = shared.ci.waitMinutes === null ? '' : String(shared.ci.waitMinutes)
  const sharedCheckpoint = shared.stats.checkpointTokens === null ? '' : String(shared.stats.checkpointTokens)
  const sharedShares = sharesText(shared.stats.checkpointShares)
  const handoffsOff = !(switchOf(text('contextHandoffs')) ?? shared.contextHandoffs)
  const kinds = on('ownKinds') ? (draft.edit.kinds as readonly CiKind[]) : shared.ci.kinds
  const kindsText = (value: Value) => shown((value as CiKind[]).map((kind) => t.settings.ciKinds[kind]))
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
    return <Fragment key={kind}>{pick(key, t.settings.remoteProfile(FORGES[kind]), t.settings.remoteProfileHint, options)}</Fragment>
  }
  const number = (key: string, value: string, invalid: boolean, onChange: (value: string) => void, extra: { placeholder?: string; disabled?: boolean; label?: string } = {}) => (
    <input
      id={fieldId(key)}
      className="settings__text settings__number"
      inputMode="numeric"
      aria-label={extra.label}
      value={value}
      placeholder={extra.placeholder}
      disabled={extra.disabled}
      aria-invalid={invalid}
      onChange={(event) => onChange(event.target.value)}
    />
  )

  const groups: Record<GroupId, () => ReactNode> = {
    repo: () => (
      <>
        <Section title={t.settings.sections.repository}>
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
            {notes('repo')}
          </div>
          {input('branch', t.settings.branch, t.settings.branchHint, 'main')}
          {input('changelog', t.settings.changelog, t.settings.changelogHint, 'CHANGELOG.md')}
          <Row
            className={marks.box('slot')}
            label={t.settings.slot}
            hint={t.settings.slotHint}
            htmlFor={fieldId('slot')}
            control={number('slot', text('slot'), wholeOf(text('slot'), 0) === undefined || errorOf('slot') !== null, (value) => edit('slot', value))}
          >
            {notes('slot')}
          </Row>
          {pick('mergeInto', t.settings.mergeInto, t.settings.mergeIntoHint, [
            { value: '', label: t.settings.mergeIntoNone },
            ...mainProjects.map((key) => ({ value: key, label: projectLabel(state, key) })),
            ...(text('mergeInto') !== '' && !mainProjects.includes(text('mergeInto'))
              ? [{ value: text('mergeInto'), label: projectLabel(state, text('mergeInto')) }]
              : []),
          ])}
          {text('mergeInto') !== '' && (
            <SwitchField
              className={marks.box('carryAgent')}
              label={t.settings.carryAgent}
              hint={t.settings.carryAgentHint}
              checked={on('carryAgent')}
              onChange={(checked) => edit('carryAgent', checked)}
            >
              {notes('carryAgent')}
            </SwitchField>
          )}
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
            {notes('color')}
          </div>
        </Section>
        <ProjectRemove project={project} />
      </>
    ),
    tracker: () => (
      <>
        <Section title={t.settings.sections.tracker}>
          {state !== null && (
            <ProjectTracker
              state={state}
              project={project}
              tracker={text('tracker')}
              trackerProject={text('trackerProject')}
              locked={locked}
              trackerNote={notes('tracker')}
              box={marks.box('trackerProject')}
              note={notes('trackerProject')}
              invalid={errorOf('trackerProject') !== null}
              onEdit={(tracker, value) =>
                setDraft(
                  tracker === text('tracker')
                    ? edited(draft, 'trackerProject', value)
                    : tracker === saved.tracker
                      ? reverted(draft, saved, ['tracker', 'trackerProject', ...STATUS_KEYS])
                      : statusesOf(tracker).reduce((each, [key, value]) => edited(each, key, value), edited(edited(draft, 'tracker', tracker), 'trackerProject', '')),
                )
              }
            />
          )}
          {text('tracker') !== 'github' && input('intakeLabel', t.settings.intakeLabel, t.settings.intakeLabelHint, t.settings.intakeLabelNone)}
          {inheritedSwitch('fillMilestone', t.settings.fillMilestone, t.settings.fillMilestoneHint, shared.fillMilestone)}
        </Section>
        {state !== null && (
          <FeedList
            state={state}
            project={project}
            tasks={tasks}
            modelLabels={switchOf(text('modelLabels')) ?? shared.modelLabels}
            mainTitle={trackerTitle}
            main={
              <SourceLine
                kind={text('tracker')}
                title={trackerTitle}
                sourceKey={state.projectKeys[project] ?? ''}
                own={form.ownRules.length > 0 || form.moves !== undefined}
                dirty={changed(draft, RULE_KEYS, same).length > 0 || moves.dirty}
                onConfigure={() => setConfiguring(true)}
              >
                {statusesReset && (
                  <Band tone="warn" action={<button type="button" className="button button--small" onClick={() => setConfiguring(true)}>{t.settings.sourceConfigure}</button>}>
                    {t.settings.statusRulesReset}
                  </Band>
                )}
              </SourceLine>
            }
          />
        )}
        {configuring && (
          <SourceDialog
            kind={text('tracker')}
            sourceKey={state?.projectKeys[project] ?? project}
            title={ruleProfile?.name ?? trackerTitle}
            tabs={[
              {
                id: 'rules',
                title: t.settings.rules,
                dirty: changed(draft, ['active', 'terminal', 'requiredLabels', 'excludedLabels'], same).length > 0,
                render: () => (
                  <RuleForm
                    level="project"
                    rules={chain}
                    inherited={inherited}
                    origins={origins}
                    profileName={ruleProfile?.name ?? null}
                    statuses={knownStatuses(
                      vocabularies.map((each) => each.statuses),
                      mainTasks.map((task) => task.status),
                      chain,
                    )}
                    labels={ruleChoices.labels}
                    modelLabels={switchOf(text('modelLabels')) ?? shared.modelLabels}
                    onEdit={(changes) => editAll(changes.map(([key, value]) => [key, ruleText(value)]))}
                    errorOf={errorOf}
                    marks={marks}
                  />
                ),
              },
              {
                id: 'milestones',
                title: t.settings.milestones,
                dirty: changed(draft, ['requiredMilestones', 'excludedMilestones'], same).length > 0,
                render: () => (
                  <Section title={t.settings.milestones} hint={t.settings.milestonesHint}>
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
                  </Section>
                ),
              },
              ...(moves.tab === null ? [] : [moves.tab]),
            ]}
            canSave={!sending && !moves.sending && next !== undefined}
            failure={leftover ?? moves.failure}
            onSave={async () => (await save()) && moves.save()}
            onRevert={() => {
              revert(statusesReset || text('tracker') !== saved.tracker ? RULE_KEYS.filter((key) => !STATUS_KEYS.includes(key)) : RULE_KEYS)
              moves.revert()
            }}
            onClose={() => setConfiguring(false)}
          />
        )}
      </>
    ),
    sessions: () => (
      <>
        <Section title={t.settings.sections.agent}>
          <ProviderChoices
            label={t.settings.provider}
            hint={t.settings.providerHint}
            className={marks.box('provider')}
            inherit={inheritOf('provider', providerName(shared.provider))}
            note={notes('provider', (value) => value === '' ? t.settings.asShared(providerName(shared.provider)) : providerName(String(value)))}
            chosen={text('provider') || shared.provider}
            onPick={(provider) => edit('provider', pickedProvider(provider, draft.base.provider as string, shared.provider))}
            columns={[
              { key: 'models', label: t.settings.model, hint: t.settings.modelHint },
              { key: 'accounts', label: t.settings.account, hint: t.settings.accountHint },
            ]}
            providers={offered}
            cell={(column, provider) => {
              const key = `${column}.${provider}`
              if (column === 'accounts') {
                const sharedAccount = shared.accounts[provider]
                const sharedLabel = sharedAccount === undefined ? '—' : folderLabel(state?.account, sharedAccount)
                const options = [
                  ...(sharedAccount === undefined ? [{ value: '', label: '—' }] : []),
                  ...(state === null ? [] : accountOptions(state.account, provider, text(key) || (sharedAccount ?? ''))),
                ]
                return (
                  <div className={marks.box(key)}>
                    <Select
                      id={fieldId(key)}
                      className="settings__text"
                      label={t.settings.accountOf(providerName(provider))}
                      value={text(key) || (sharedAccount ?? '')}
                      options={options}
                      invalid={errorOf(key) !== null}
                      onChange={(value) => edit(key, value)}
                    />
                    <Inherit {...inheritOf(key, sharedLabel)} />
                    {notes(key, (value) => (value === '' ? t.settings.asShared(sharedLabel) : labelOf(options)(value)))}
                  </div>
                )
              }
              const offers = offersOf(models, rowAccount(provider))
              const sharedModel = shared.models[provider] ?? t.settings.cliDefault
              return (
                <div className={marks.box(key)}>
                  <input
                    id={fieldId(key)}
                    className="settings__text settings__text--mono"
                    aria-label={t.settings.modelOf(providerName(provider))}
                    spellCheck={false}
                    value={text(key)}
                    placeholder={sharedModel}
                    aria-invalid={errorOf(key) !== null}
                    list={offers.length === 0 ? undefined : `${fieldId(key)}-models`}
                    onChange={(event) => edit(key, event.target.value)}
                  />
                  <ModelOffers id={`${fieldId(key)}-models`} models={offers} />
                  <Inherit {...inheritOf(key, sharedModel)} />
                  {notes(key, (value) => (value === '' ? t.settings.asShared(sharedModel) : String(value)))}
                </div>
              )
            }}
          />
          {inheritedSwitch('modelLabels', t.settings.modelLabels, t.settings.modelLabelsHint, shared.modelLabels)}
          {mayRunClaude && <TrustWarning project={project} account={rowAccount(CLAUDE)} />}
        </Section>
        <Section title={t.settings.sections.prompt}>
          {pick('brief', t.settings.brief, t.settings.briefHint, [
            { value: '', label: t.settings.briefAuto },
            { value: 'true', label: t.settings.on },
            { value: 'false', label: t.settings.off },
          ])}
          {state !== null && (
            <div className="settings__line-extra">
              <TrackerPackageButton project={project} packages={state.packages} />
            </div>
          )}
          {lines('prompt', t.settings.prompt, t.settings.promptHint, t.settings.promptPlaceholder, 5, false)}
          {lines('beforeStart', t.settings.beforeStart, t.settings.beforeStartHint, t.settings.beforeStartPlaceholder, 4)}
          {pick(
            'promptLanguage',
            t.shared.promptLanguage,
            t.settings.promptLanguageHint,
            LANGUAGES.map((language) => ({ value: language, label: t.shared.languages[language] })),
            { value: shared.promptLanguage, label: t.shared.languages[shared.promptLanguage] },
          )}
        </Section>
        <Section title={t.settings.standards.title} hint={t.settings.standards.hint}>
          <ProjectStandards
            className={marks.box('standards')}
            project={project}
            branch={text('branch').trim() || form.branch}
            trim={state?.trimTools ?? false}
            value={text('standards')}
            onChange={(value) => edit('standards', value)}
          >
            {notes('standards', standardsShown)}
          </ProjectStandards>
        </Section>
        <Section title={t.settings.gets.title} hint={t.settings.gets.hint(providerName(text('provider') || shared.provider))}>
          <SessionGets
            project={project}
            agent={text('provider') || shared.provider}
            prompts={{ shared: (shared.prompt ?? '').trim() !== '', project: text('prompt').trim() !== '' }}
            packages={state?.packages ?? null}
            trim={state?.trimTools ?? false}
            standards={standardRows(text('standards')).map((row) => row.doc).filter((doc) => doc !== '')}
          />
        </Section>
        <ProtectionSettings value={text('protection')} shared={shared.protection ?? DEFAULT_PROTECTION} onChange={value => edit('protection', value)} error={errorOf('protection')} />
        {notes('protection')}
        <Section title={t.settings.sections.context}>
          <Row
            className={marks.box(['ownAutoCompact', 'autoCompactWindow'])}
            label={t.shared.autoCompactWindow}
            hint={t.shared.autoCompactWindowHint}
            htmlFor={fieldId('autoCompactWindow')}
            inherit={ownInherit('ownAutoCompact', { autoCompactWindow: shared.autoCompactWindow === null ? '' : String(shared.autoCompactWindow) }, shared.autoCompactWindow === null ? t.shared.autoCompactWindowAccount : String(shared.autoCompactWindow))}
            control={number(
              'autoCompactWindow',
              on('ownAutoCompact') ? text('autoCompactWindow') : shared.autoCompactWindow === null ? '' : String(shared.autoCompactWindow),
              on('ownAutoCompact') && compactWindowOf(text('autoCompactWindow')) === undefined,
              (value) => ownEdit('ownAutoCompact', { autoCompactWindow: shared.autoCompactWindow === null ? '' : String(shared.autoCompactWindow) })('autoCompactWindow', value),
              { placeholder: t.shared.autoCompactWindowAccount },
            )}
          >
            {flagNote('ownAutoCompact')}
            {marks.note('autoCompactWindow', (value) => (value as string).trim() === '' ? t.shared.autoCompactWindowAccount : value as string)}
            <FieldNote error={on('ownAutoCompact') && compactWindowOf(text('autoCompactWindow')) === undefined ? { code: 'config.autoCompactWindow', params: { value: text('autoCompactWindow') } } : errorOf('autoCompactWindow')} />
          </Row>
          {inheritedSwitch('contextHandoffs', t.shared.contextHandoffs, t.shared.contextHandoffsHint, shared.contextHandoffs)}
          <Row
            className={marks.box(['ownCheckpoint', 'checkpointTokens'])}
            label={t.shared.checkpointTokens}
            hint={t.shared.checkpointTokensHint}
            htmlFor={fieldId('checkpointTokens')}
            inherit={ownInherit('ownCheckpoint', { checkpointTokens: sharedCheckpoint }, sharedCheckpoint || t.shared.checkpointTokensPlaceholder, handoffsOff)}
            control={number(
              'checkpointTokens',
              on('ownCheckpoint') ? text('checkpointTokens') : sharedCheckpoint,
              on('ownCheckpoint') && tokensOf(text('checkpointTokens')) === undefined,
              (value) => ownEdit('ownCheckpoint', { checkpointTokens: sharedCheckpoint })('checkpointTokens', value),
              { placeholder: t.shared.checkpointTokensPlaceholder, disabled: handoffsOff },
            )}
          >
            {flagNote('ownCheckpoint')}
            {marks.note('checkpointTokens', (value) => ((value as string).trim() === '' ? t.shared.checkpointTokensPlaceholder : (value as string)))}
            <FieldNote error={errorOf('stats.checkpointTokens')} />
          </Row>
          <div className={marks.box('ownShares')}>
            <FieldHead
              label={t.shared.checkpointShares}
              hint={t.shared.checkpointSharesHint}
              inherit={ownInherit('ownShares', sharedShares, SHARE_KEYS.map((key) => sharedShares[key]).join(' / '), handoffsOff)}
            />
            <div className="settings__row">
              {SHARE_KEYS.map((key) => (
                <div key={key} className={marks.box(key)}>
                  <FieldHead label={t.shared[key]} htmlFor={fieldId(key)} />
                  {number(key, on('ownShares') ? text(key) : sharedShares[key], on('ownShares') && shareOf(text(key)) === undefined, (value) => ownEdit('ownShares', sharedShares)(key, value), {
                    disabled: handoffsOff,
                  })}
                  {marks.note(key)}
                </div>
              ))}
            </div>
            {flagNote('ownShares')}
            <FieldNote error={errorOf('checkpointShares')} />
          </div>
          {pick(
            'cacheTtl',
            t.shared.cacheTtl,
            t.shared.cacheTtlHint,
            [
              { value: CLI_TTL, label: t.shared.cacheTtlAuto },
              { value: '5m', label: t.shared.cacheTtl5m },
              { value: '1h', label: t.shared.cacheTtl1h },
            ],
            { value: shared.cacheTtl ?? CLI_TTL, label: ttlLabel(shared.cacheTtl) },
          )}
        </Section>
      </>
    ),
    ci: () => (
      <>
        <Section title={t.settings.sections.guard}>
          {inheritedSwitch('guard', t.settings.guard, t.settings.guardHint, shared.ci.guard)}
          {/* With the guard off the values stay as they are, only greyed out: turning it back on brings them back. */}
          <div className={unguarded ? 'settings__guarded settings__guarded--off' : 'settings__guarded'}>
            {lines('check', t.settings.check, t.settings.checkHint, t.settings.checkPlaceholder, 3, true, unguarded)}
            {lines('afterGreen', t.settings.afterGreen, t.settings.afterGreenHint, t.settings.afterGreenPlaceholder, 3, true, unguarded)}
            <fieldset className={marks.box(['ownKinds', 'kinds'], 'settings__field settings__group')}>
              <legend>
                <FieldHead label={t.settings.ci} hint={t.settings.ciHint} inherit={ownInherit('ownKinds', { kinds: shared.ci.kinds }, kindsText(shared.ci.kinds), unguarded)} />
              </legend>
              <div className="settings__checks">
                {CI_KINDS.map((kind) => (
                  <label key={kind} className="settings__check">
                    <input
                      type="checkbox"
                      checked={kinds.includes(kind)}
                      disabled={unguarded}
                      onChange={(event) =>
                        ownEdit('ownKinds', { kinds: shared.ci.kinds })(
                          'kinds',
                          CI_KINDS.filter((each) => (each === kind ? event.target.checked : kinds.includes(each))),
                        )
                      }
                    />
                    {t.settings.ciKinds[kind]}
                  </label>
                ))}
              </div>
              {flagNote('ownKinds')}
              {marks.note('kinds', kindsText)}
              <FieldNote error={errorOf('ci')} />
            </fieldset>
            <Row
              className={marks.box(['ownWait', 'wait'])}
              label={t.settings.ciWait}
              hint={t.settings.ciWaitHint}
              htmlFor={fieldId('wait')}
              inherit={ownInherit('ownWait', { wait: sharedWait }, sharedWait || t.settings.ciWaitPlaceholder, unguarded)}
              control={number(
                'wait',
                on('ownWait') ? text('wait') : sharedWait,
                on('ownWait') && minutesOf(text('wait')) === undefined,
                (value) => ownEdit('ownWait', { wait: sharedWait })('wait', value),
                { placeholder: t.settings.ciWaitPlaceholder, disabled: unguarded },
              )}
            >
              {flagNote('ownWait')}
              {marks.note('wait', (value) => ((value as string).trim() === '' ? t.settings.ciWaitPlaceholder : shown(value)))}
            </Row>
            {inheritedSwitch('recheck', t.settings.recheckMain, t.settings.recheckMainHint, shared.ci.recheckMain, unguarded)}
            {inheritedSwitch('fixTask', t.settings.fixTask, t.settings.fixTaskHint, shared.ci.fixTask, unguarded)}
          </div>
        </Section>
        <Section title={t.settings.sections.pulls}>
          <SwitchField
            className={marks.box('pullRequests')}
            label={t.settings.pullRequests}
            hint={t.settings.pullRequestsHint}
            checked={on('pullRequests')}
            disabled={pullReadiness !== null && !on('pullRequests') && saved.pullRequests !== true}
            onChange={(checked) => edit('pullRequests', checked)}
          >
            {notes('pullRequests')}
          </SwitchField>
          <div className="settings__line-extra">
            <PullHint readiness={pullReadiness} on={on('pullRequests')} />
            <AddPullProfile readiness={pullReadiness} />
          </div>
          {CI_KINDS.map(remoteChoice)}
        </Section>
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
