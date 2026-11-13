import { Fragment, useEffect, type ReactNode } from 'react'
import { ProtectionSettings } from './ProtectionSettings.js'
import { useSearchParams } from 'react-router'
import { EXECUTION_MODES } from '../../../src/agent/providers.js'
import { CliSourceChoice } from '../layout/CliSource.js'
import type { CliSource } from '../layout/cliLock.js'
import { cliText } from '../layout/cliText.js'
import { DEFAULT_RULES } from '../../../src/chain/rules.js'
import { CI_KINDS, type CiKind } from '../../../src/ci/model.js'
import { LANGUAGES } from '../../../src/language.js'
import type { EvenKeelState } from '../../../src/state.js'
import { offeredProviders } from '../accounts.js'
import { examplePaths } from '../examplePaths.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useToolsViews } from '../tools/useToolsViews.js'
import { Select } from '../ui/Select.js'
import { changed, edited, reverted, sent, type Value } from './settingsDraft.js'
import {
  ErrorStrip,
  FieldHead,
  FieldNote,
  fieldId,
  HelpTip,
  marksOf,
  minutesOf,
  Row,
  RULE_KEYS,
  rulesOf,
  SaveBar,
  Section,
  SHARE_KEYS,
  shareOf,
  shown,
  SwitchField,
  unplaced,
  UnsavedDot,
  useFieldErrors,
  wholeOf,
  type RuleKey,
} from './settingsParts.js'
import { TrackerIcon } from '../ui/icons.js'
import { TokensInput } from '../ui/TokensInput.js'
import { countFrom, tokensShown } from '../ui/tokens.js'
import { knownStatuses, originsAt } from './ruleRows.js'
import { MilestoneFields, RuleForm, ruleText } from './RuleForm.js'
import { lineOf, linesText, pairOf, ruleChoicesOf, rowsOf } from './settingsRows.js'
import { accountOptions, namedProviders, providerKeys, providerName, WINDOW_KEYS } from './settingsRun.js'
import { ProviderChoices } from './ProviderChoices.js'
import { SuggestField } from '../ui/SuggestField.js'
import { ModelPrompts } from './ModelPrompts.js'
import { profileGroup, ProfileRules } from './ProfileRules.js'
import { profileAddOf } from './pullFix.js'
import { offersOf, useModelCatalog } from './useModels.js'
import { useModelReset } from './modelReset.js'
import { openTab, SHARED_SCOPE, useDraft, useTab } from './settingsStore.js'
import { ListTable, RowsTable } from './settingsTable.js'
import { invalidPending, TableDraft, validateTables } from './settingsTableDraft.js'
import { SettingsNav } from './SettingsNav.js'
import { SettingsProfiles } from './SettingsProfiles.js'
import { ClassifierSettings, PageToken } from './SettingsSecrets.js'
import { TallySettings } from './TallyChoice.js'
import { NoticeSettings } from './NoticeSettings.js'
import { PackageCatalog } from '../tools/PackageCatalog.js'
import { PACKAGE_PARAM } from '../tools/packageGroups.js'
import { noticeTexts } from '../i18n/notice-choices.js'
import { useVocabularies } from './useVocabularies.js'
import { amountOf, EXECUTED, formOf, promptsOf, same, valuesOf } from './sharedSettingsForm.js'
import './settings.css'

const SCOPE = SHARED_SCOPE

const GROUPS = [
  { id: 'chain', keys: ['parallel', 'brief', 'fillMilestone', 'defaultGit'] },
  // The connections before the rules over them (BTN-355); a profile is applied on its own and never kept in a draft.
  { id: 'trackers', keys: [] },
  // The shared rules, together with a switch to the rules of each tracker profile, which are saved apart (BTN-66).
  { id: 'rules', keys: [...RULE_KEYS] },
  {
    id: 'models',
    keys: ['provider', ...providerKeys('models'), ...providerKeys('accounts'), ...providerKeys('execution', EXECUTED), ...providerKeys('cli'), ...Object.values(WINDOW_KEYS), 'cliCheck', 'prompt', 'modelPrompts', 'promptLanguage'],
  },
  { id: 'sessions', keys: ['protection', 'hiddenSkills', 'window', 'warn', 'danger', 'contextHandoffs', 'checkpointTokens', ...SHARE_KEYS, 'cacheTtl', 'keepWarm'] },
  { id: 'ci', keys: ['guard', 'kinds', 'wait', 'recheck', 'fixTask', 'rerun'] },
  // The catalog of packages (BTN-802): each change is sent at once, no draft.
  { id: 'packages', keys: [] },
  { id: 'page', keys: ['language', 'allowedHosts', 'attachmentLimit', 'updatesCheck', 'updatesNotify'] },
  // Each switch applies at once, as "Don't show again" on a banner does (BTN-759): no draft.
  { id: 'notices', keys: [] },
  { id: 'stats', keys: ['minTasks', 'minSessions', 'days', 'otherBelow', 'moves'] },
] as const
type GroupId = (typeof GROUPS)[number]['id']
const keysOf = (id: GroupId): readonly string[] => GROUPS.find((group) => group.id === id)!.keys
export function SharedSettings({ state }: { state: EvenKeelState }) {
  const { config, configError } = state
  const { send, sending, failure } = useCommand()
  const modes = useCommand()
  const saved = valuesOf(config.shared)
  const [current, setDraft] = useDraft(SCOPE, saved, same)
  const draft = current!
  const [tab, setOpen] = useTab<string>(SCOPE, 'chain')
  // A tracker profile's rules are a tab of the rules group (BTN-66), one per profile; a removed profile's tab falls back to the shared rules.
  const ruled = state.profiles.profiles.filter((profile) => state.profiles.kinds.some((kind) => kind.kind === profile.kind && kind.tracker))
  const ruledOpen = ruled.find((profile) => profileGroup(profile.id) === tab)
  // The profiles were on the "Access" tab (`secrets`) until BTN-355: a link or a kept tab of it lands on their new one.
  const open: GroupId = GROUPS.some((group) => group.id === tab)
    ? (tab as GroupId)
    : tab === 'secrets'
      ? 'trackers'
      : tab.startsWith(profileGroup(''))
        ? 'rules'
        : 'chain'
  const [params] = useSearchParams()
  const addsProfile = profileAddOf(params) !== null
  const asksPackage = params.has(PACKAGE_PARAM)
  // A link asking for a profile (PR mode, EKR-7) or a package lands on the tab it opens in.
  useEffect(() => {
    if (addsProfile) openTab(SCOPE, 'trackers')
    else if (asksPackage) openTab(SCOPE, 'packages')
  }, [addsProfile, asksPackage])
  const vocabularies = useVocabularies(state.projects)
  const chain = rulesOf(draft.edit as Record<RuleKey, Value>)
  const choices = ruleChoicesOf(state.tasks, vocabularies)
  const dirty = (id: GroupId) => changed(draft, keysOf(id), same).length > 0
  const outgoing = sent(draft, keysOf(open))
  const next = formOf(outgoing.form)
  const base = formOf(outgoing.base)
  const errorOf = useFieldErrors(null, [failure, configError], config)
  const leftover = unplaced(null, failure, config)
  const text = (key: string) => draft.edit[key] as string
  const offered = offeredProviders(state.account, namedProviders(text, [text('provider')], ['models']))
  const models = useModelCatalog(offered.map((provider) => text(`accounts.${provider}`)))
  const titleOf = (id: GroupId) => t.shared[id]
  const hintOf: Partial<Record<GroupId, string>> = { ci: t.shared.ciNote, notices: noticeTexts().hint }
  const groupTitle = (id: GroupId) => (
    <h2 id="settings-group" className="settings-page__group">
      {titleOf(id)}
      {hintOf[id] !== undefined && <HelpTip text={hintOf[id]} align="start" />}
    </h2>
  )

  const edit = (key: string, value: Value) => setDraft(edited(draft, key, value))
  const editAll = (changes: [string, Value][]) => setDraft(changes.reduce((each, [key, value]) => edited(each, key, value), draft))
  const revert = (keys: readonly string[]) => setDraft(reverted(draft, saved, keys))
  const marks = marksOf(draft, saved, same, revert)
  useModelReset(
    offered.map((provider) => ({ provider, choice: text(`accounts.${provider}`), account: text(`accounts.${provider}`), model: text(`models.${provider}`) })),
    models,
    (providers) => editAll(providers.map((provider) => [`models.${provider}`, ''])),
  )
  const save = async () => {
    if (next === undefined || base === undefined) return
    await send('settings', { ...next, base } as unknown as Record<string, unknown>)
  }
  const numberInput = (key: string, invalid: boolean, extra: { placeholder?: string; disabled?: boolean } = {}) => (
    <input
      id={fieldId(key)}
      className="settings__text settings__number"
      inputMode="numeric"
      autoComplete="off"
      value={text(key)}
      placeholder={extra.placeholder}
      disabled={extra.disabled}
      aria-invalid={invalid}
      onChange={(event) => edit(key, event.target.value)}
    />
  )
  const tokensInput = (key: string, invalid: boolean, extra: { placeholder?: string; disabled?: boolean } = {}) => (
    <TokensInput id={fieldId(key)} value={text(key)} invalid={invalid} placeholder={extra.placeholder} disabled={extra.disabled} onChange={(value) => edit(key, value)} />
  )
  const tokensNote = (key: string, empty: string) => marks.note(key, (value) => ((value as string).trim() === '' ? empty : tokensShown(value as string)))
  // A number among others of one setting: its name above it.
  const number = (key: string, label: string, invalid: boolean, disabled = false, tokens = false) => (
    <div className={marks.box(key)}>
      <FieldHead label={label} htmlFor={fieldId(key)} mark={marks.note(key)} />
      {tokens ? tokensInput(key, invalid, { disabled }) : numberInput(key, invalid, { disabled })}
    </div>
  )
  const numberRow = (key: string, label: string, invalid: boolean, hint?: string) => (
    <Row className={marks.box(key)} label={label} hint={hint} htmlFor={fieldId(key)} mark={marks.note(key)} control={numberInput(key, invalid)} error={errorOf(key)} />
  )
  const select = (key: string, label: string, options: readonly { value: string; label: string }[], hint?: string) => (
    <Row
      className={marks.box(key)}
      label={label}
      hint={hint}
      htmlFor={fieldId(key)}
      mark={marks.note(key, (value) => options.find((option) => option.value === value)?.label ?? String(value))}
      control={<Select id={fieldId(key)} className="settings__text" value={text(key)} options={options} onChange={(value) => edit(key, value)} />}
      error={errorOf(key)}
    />
  )
  // The model is typed freely; the account is picked from the offered folders.
  const model = (key: string, label: string, offers: readonly string[]) => (
    <div className={marks.box(key)}>
      <ErrorStrip error={errorOf(key)} wide>
        <SuggestField
          id={fieldId(key)}
          className="settings__text settings__text--mono"
          label={label}
          mono
          value={text(key)}
          options={offers}
          placeholder={t.settings.cliDefault}
          invalid={errorOf(key) !== null}
          onChange={(value) => edit(key, value)}
        />
      </ErrorStrip>
    </div>
  )
  const pick = (key: string, label: string, options: readonly { value: string; label: string }[]) => (
    <div className={marks.box(key)}>
      <ErrorStrip error={errorOf(key)} wide>
        <Select id={fieldId(key)} className="settings__text" label={label} value={text(key)} options={options} onChange={(value) => edit(key, value)} />
      </ErrorStrip>
    </div>
  )
  const check = (key: string, label: string, hint: string, disabled = false, error = key) => (
    <SwitchField className={marks.box(key)} label={label} hint={hint} checked={draft.edit[key] as boolean} disabled={disabled} mark={marks.note(key)} onChange={(on) => edit(key, on)}>
      <FieldNote error={errorOf(error)} />
    </SwitchField>
  )
  const kinds = draft.edit.kinds as readonly CiKind[]
  const unguarded = !(draft.edit.guard as boolean)
  const handoffsOff = !(draft.edit.contextHandoffs as boolean)
  // A provider's auto-compaction window, a cell of its card; empty is the account's window for Claude, the model's for the rest.
  const windowEmpty = (provider: string) => (provider === 'claude' ? t.shared.autoCompactWindowAccount : t.shared.codexAutoCompactWindowModel)
  const windowCell = (provider: string) => {
    const key = WINDOW_KEYS[provider]
    if (key === undefined) return null
    const bad = countFrom(text(key), 1) === undefined
    return (
      <div className={marks.box(key)}>
        <ErrorStrip error={bad ? { code: `config.${key}`, params: { value: text(key) } } : errorOf(key)} wide>
          <TokensInput id={fieldId(key)} label={t.shared.autoCompactWindowOf(providerName(provider))} value={text(key)} invalid={bad} placeholder={windowEmpty(provider)} onChange={(value) => edit(key, value)} />
        </ErrorStrip>
      </div>
    )
  }
  const languages = LANGUAGES.map((language) => ({ value: language, label: t.shared.languages[language] }))

  const modesFailure = modes.failure !== null && <p className="notice notice--error">{say(modes.failure)}</p>

  const groups: Record<GroupId, () => ReactNode> = {
    chain: () => (
      <>
        <Section title={t.shared.sections.run}>
          <SwitchField
            className="settings__field"
            label={t.status.unattended}
            hint={t.status.unattendedHint}
            checked={state.unattended}
            disabled={modes.sending}
            onChange={(on) => void modes.send('chain/unattended', { on })}
          />
          {modesFailure}
          {numberRow('parallel', t.shared.parallel, wholeOf(text('parallel'), 1) === undefined || errorOf('parallel') !== null, t.shared.parallelHint)}
        </Section>
        <Section title={t.shared.sections.tasks}>
          {select(
            'brief',
            t.settings.brief,
            [
              { value: '', label: t.settings.briefAuto },
              { value: 'true', label: t.settings.on },
              { value: 'false', label: t.settings.off },
            ],
            t.settings.briefHint,
          )}
          {check('fillMilestone', t.settings.fillMilestone, `${t.settings.fillMilestoneHint} ${t.shared.forProjects}`)}
          {select(
            'defaultGit',
            t.shared.defaultGit,
            [
              { value: '', label: t.shared.defaultGitAuto },
              { value: 'true', label: t.shared.defaultGitOn },
              { value: 'false', label: t.shared.defaultGitOff },
            ],
            t.shared.defaultGitHint,
          )}
        </Section>
      </>
    ),
    rules: () => (
      <>
        <RuleForm
          level="shared"
          rules={chain}
          inherited={DEFAULT_RULES}
          origins={originsAt('shared')}
          profileName={null}
          statuses={knownStatuses(
            vocabularies.map((each) => each.statuses),
            state.tasks.map((task) => task.status),
            chain,
          )}
          labels={choices.labels}
          onEdit={(changes) => editAll(changes.map(([key, value]) => [key, ruleText(value)]))}
          errorOf={errorOf}
          marks={marks}
        />
        <Section title={t.settings.milestones} hint={`${t.settings.milestonesHint} ${t.shared.forProjects}`}>
          <MilestoneFields
            level="shared"
            rules={chain}
            inherited={DEFAULT_RULES}
            origins={originsAt('shared')}
            milestones={choices.milestones}
            text={text}
            onEdit={editAll}
            errorOf={errorOf}
            marks={marks}
          />
        </Section>
      </>
    ),
    models: () => (
      <>
        <Section title={t.shared.sections.agent}>
          <ProviderChoices
            label={t.settings.provider}
            hint={t.shared.providerHint}
            className={marks.box('provider')}
            mark={marks.note('provider', (value) => providerName(String(value)))}
            note={<FieldNote error={errorOf('provider')} />}
            chosen={text('provider')}
            onPick={(provider) => edit('provider', provider)}
            columns={[
              { key: 'models', label: t.settings.model, hint: t.shared.modelHint },
              { key: 'accounts', label: t.settings.account, hint: t.shared.accountHint },
              { key: 'window', label: t.shared.autoCompactWindow, hint: t.shared.autoCompactWindowColumnHint },
              { key: 'execution', label: t.shared.execution, hint: t.shared.executionHint },
              { key: 'cli', label: t.shared.cli, hint: t.shared.cliHint },
            ]}
            providers={offered}
            cell={(column, provider) => {
              const name = providerName(provider)
              if (column === 'models') return model(`models.${provider}`, t.settings.modelOf(name), offersOf(models, text(`accounts.${provider}`)))
              if (column === 'accounts') return pick(`accounts.${provider}`, t.settings.accountOf(name), accountOptions(state.account, provider, text(`accounts.${provider}`)))
              if (column === 'window') return windowCell(provider)
              // The CLI's source is a field of the form, saved with Execution, so the service judges the pair as the form
              // holds it (BTN-682); a missing checked copy is offered for download once the save lands (`useCommand`).
              if (column === 'cli') {
                if (!state.cliCopies?.[provider]) return null
                const key = `cli.${provider}`
                return (
                  <div className={marks.box(key)}>
                    <CliSourceChoice
                      provider={provider}
                      label={t.shared.cliOf(name)}
                      execution={text(`execution.${provider}`)}
                      picked={same(key, draft.edit[key]!, saved[key]!) ? undefined : (text(key) as CliSource)}
                      onPick={(source) => edit(key, source)}
                    />
                  </div>
                )
              }
              const modes = EXECUTION_MODES[provider]
              return modes === undefined
                ? null
                : pick(
                    `execution.${provider}`,
                    t.shared.executionOf(name),
                    modes.map((mode) => ({ value: mode, label: t.shared.modes[mode] ?? mode })),
                  )
            }}
            cellMark={(column, provider) => {
              const key = `${column}.${provider}`
              if (column === 'models') return marks.note(key, (value) => ((value as string).trim() === '' ? t.settings.cliDefault : (value as string)))
              if (column === 'accounts') {
                const options = accountOptions(state.account, provider, text(key))
                return marks.note(key, (value) => options.find((option) => option.value === value)?.label ?? String(value))
              }
              if (column === 'cli') return marks.note(key, (value) => (value === 'system' ? cliText().yoursShort : cliText().checkedShort))
              if (column === 'window') {
                const window = WINDOW_KEYS[provider]
                return window === undefined ? null : tokensNote(window, windowEmpty(provider))
              }
              if (column !== 'execution') return null
              return marks.note(key, (value) => t.shared.modes[String(value)] ?? String(value))
            }}
          />
          {check('cliCheck', t.shared.cliCheck, t.shared.cliCheckHint)}
        </Section>
        <Section title={t.shared.sections.prompts}>
          <div className={marks.box('prompt')}>
            <FieldHead label={t.settings.prompt} hint={t.shared.promptHint} htmlFor={fieldId('prompt')} mark={marks.note('prompt', (value) => ((value as string).trim() === '' ? t.shared.none : (value as string)))} />
            <ErrorStrip error={errorOf('prompt')} wide>
              <textarea
                id={fieldId('prompt')}
                className="settings__text"
                rows={5}
                value={text('prompt')}
                placeholder={t.shared.promptPlaceholder}
                onChange={(event) => edit('prompt', event.target.value)}
              />
            </ErrorStrip>
          </div>
          <div className={marks.box('modelPrompts')}>
            <FieldHead label={t.shared.modelPrompts} hint={t.shared.modelPromptsHint} mark={marks.note('modelPrompts', (value) => promptsOf(value as string).map(([name]) => name).join(', ') || t.shared.none)} />
            <ModelPrompts value={text('modelPrompts')} accounts={state.account} onChange={(value) => edit('modelPrompts', value)} />
            <FieldNote error={errorOf('modelPrompts')} />
          </div>
          {select('promptLanguage', t.shared.promptLanguage, languages)}
        </Section>
      </>
    ),
    sessions: () => (
      <>
        <Section title={t.shared.sections.tools}>
          <SwitchField
            className="settings__field"
            label={t.status.trim}
            hint={t.status.trimHint}
            checked={state.trimTools}
            disabled={modes.sending}
            onChange={(on) => void modes.send('chain/trim', { on })}
          />
          {modesFailure}
          <div className={marks.box('hiddenSkills')}>
            <FieldHead label={t.shared.hiddenSkills} hint={t.shared.hiddenSkillsHint} mark={marks.note('hiddenSkills')} />
            <HiddenSkills state={state} value={text('hiddenSkills')} onChange={(value) => edit('hiddenSkills', value)} />
            <FieldNote error={errorOf('hiddenSkills')} />
          </div>
        </Section>
        <ProtectionSettings value={text('protection')} onChange={value => edit('protection', value)} error={errorOf('protection')} />
        <Section title={t.shared.sections.context}>
          <div className="settings__field">
            <FieldHead label={t.shared.context} hint={t.shared.contextHint} />
            <div className="settings__row">
              {number('window', t.shared.contextWindow, (countFrom(text('window'), 1) ?? undefined) === undefined, false, true)}
              {number('warn', t.shared.contextWarn, amountOf(text('warn')) === undefined)}
              {number('danger', t.shared.contextDanger, amountOf(text('danger')) === undefined)}
            </div>
            <FieldNote error={errorOf('context')} />
          </div>
          {check('contextHandoffs', t.shared.contextHandoffs, `${t.shared.contextHandoffsHint} ${t.shared.forProjects}`)}
          <Row
            className={marks.box('checkpointTokens')}
            label={t.shared.checkpointTokens}
            hint={t.shared.checkpointTokensHint}
            htmlFor={fieldId('checkpointTokens')}
            mark={tokensNote('checkpointTokens', t.shared.checkpointTokensPlaceholder)}
            control={tokensInput('checkpointTokens', countFrom(text('checkpointTokens'), 0) === undefined, {
              placeholder: t.shared.checkpointTokensPlaceholder,
              disabled: handoffsOff,
            })}
            error={errorOf('checkpointTokens')}
          />
          <div className="settings__field">
            <FieldHead label={t.shared.checkpointShares} hint={t.shared.checkpointSharesHint} />
            <div className="settings__row">
              {SHARE_KEYS.map((key) => (
                <Fragment key={key}>{number(key, t.shared[key], shareOf(text(key)) === undefined, handoffsOff)}</Fragment>
              ))}
            </div>
            <FieldNote error={errorOf('checkpointShares')} />
          </div>
        </Section>
        <Section title={t.shared.claude}>
          {select(
            'cacheTtl',
            t.shared.cacheTtl,
            [
              { value: '', label: t.shared.cacheTtlAuto },
              { value: '5m', label: t.shared.cacheTtl5m },
              { value: '1h', label: t.shared.cacheTtl1h },
            ],
            t.shared.cacheTtlHint,
          )}
          {numberRow('keepWarm', t.shared.keepWarm, wholeOf(text('keepWarm'), 0) === undefined || errorOf('keepWarm') !== null, t.shared.keepWarmHint)}
        </Section>
      </>
    ),
    ci: () => (
      <Section title={t.settings.sections.guard}>
        {check('guard', t.settings.guard, t.settings.guardHint)}
        <div className={unguarded ? 'settings__guarded settings__guarded--off' : 'settings__guarded'}>
          <fieldset className={marks.box('kinds', 'settings__field settings__group')}>
            <legend>
              <FieldHead label={t.settings.ci} hint={t.settings.ciHint} mark={marks.note('kinds', (value) => shown((value as CiKind[]).map((kind) => t.settings.ciKinds[kind])))} />
            </legend>
            <div className="settings__checks">
              {CI_KINDS.map((kind) => (
                <label key={kind} className="settings__check">
                  <input
                    type="checkbox"
                    checked={kinds.includes(kind)}
                    disabled={unguarded}
                    onChange={(event) => edit('kinds', CI_KINDS.filter((each) => (each === kind ? event.target.checked : kinds.includes(each))))}
                  />
                  {t.settings.ciKinds[kind]}
                </label>
              ))}
            </div>
            <FieldNote error={errorOf('ci')} />
          </fieldset>
          <Row
            className={marks.box('wait')}
            label={t.settings.ciWait}
            hint={t.settings.ciWaitHint}
            htmlFor={fieldId('wait')}
            mark={marks.note('wait', (value) => ((value as string).trim() === '' ? t.settings.ciWaitPlaceholder : shown(value)))}
            control={numberInput('wait', minutesOf(text('wait')) === undefined, { placeholder: t.settings.ciWaitPlaceholder, disabled: unguarded })}
          />
          {check('recheck', t.settings.recheckMain, t.settings.recheckMainHint, unguarded)}
          {check('fixTask', t.settings.fixTask, t.settings.fixTaskHint, unguarded)}
          {check('rerun', t.settings.rerunFailed, t.settings.rerunFailedHint, unguarded)}
        </div>
      </Section>
    ),
    page: () => (
      <>
        <Section title={t.shared.sections.interface}>
          {select('language', t.shared.language, [{ value: '', label: t.shared.languageAuto }, ...languages])}
          {check('updatesCheck', t.shared.updatesCheck, t.shared.updatesCheckHint, false, 'updates')}
          {check('updatesNotify', t.shared.updatesNotify, t.shared.updatesNotifyHint)}
          {numberRow('attachmentLimit', t.shared.attachmentLimit, wholeOf(text('attachmentLimit'), 1) === undefined || errorOf('attachmentLimit') !== null, t.shared.attachmentLimitHint)}
        </Section>
        <Section title={t.shared.sections.access}>
          <PageToken state={state} />
          <div className={marks.box('allowedHosts')}>
            <FieldHead label={t.shared.allowedHosts} hint={t.shared.allowedHostsHint} mark={marks.note('allowedHosts')} />
            <ListTable
              field="allowedHosts"
              label={t.shared.allowedHosts}
              value={text('allowedHosts')}
              add={t.shared.allowedHostsAdd}
              empty={t.shared.allowedHostsEmpty}
              mono
              onChange={(value) => edit('allowedHosts', value)}
            />
            <FieldNote error={errorOf('allowedHosts')} />
          </div>
        </Section>
      </>
    ),
    stats: () => (
      <>
        <Section title={t.shared.compare} hint={t.shared.compareHint}>
          <div className="settings__row">
            {number('minTasks', t.shared.minTasks, wholeOf(text('minTasks'), 1) === undefined)}
            {number('minSessions', t.shared.minSessions, wholeOf(text('minSessions'), 1) === undefined)}
            {number('days', t.shared.days, wholeOf(text('days'), 1) === undefined)}
          </div>
        </Section>
        <Section title={t.shared.sections.other}>
          {numberRow('otherBelow', t.shared.otherBelow, amountOf(text('otherBelow')) === undefined, t.shared.otherBelowHint)}
          <div className={marks.box('moves')}>
            <FieldHead label={t.shared.moves} hint={t.shared.movesHint} mark={marks.note('moves')} />
            <RowsTable
              field="moves"
              encode={(rows) => linesText(rows.map(lineOf))}
              label={t.shared.moves}
              columns={[
                { title: t.shared.movesFrom, placeholder: examplePaths(state.platform).movedFrom, mono: true },
                { title: t.shared.movesTo, placeholder: examplePaths(state.platform).movedTo, mono: true },
              ]}
              rows={rowsOf(text('moves')).map(pairOf)}
              empty={t.shared.none}
              onChange={(rows) => edit('moves', linesText(rows.map(lineOf)))}
            />
          </div>
          <FieldNote error={errorOf('stats')} />
        </Section>
      </>
    ),
    trackers: () => <SettingsProfiles state={state} onRules={(id) => setOpen(profileGroup(id))} />,
    notices: () => <NoticeSettings />,
    packages: () => <PackageCatalog state={state} />,
  }

  const draftForm = (titled: boolean) => (
    <TableDraft value={{ draft, setDraft }}>
    <form
      key={open}
      className={titled ? 'settings__form settings-page__form' : 'settings__form'}
      aria-labelledby={titled ? 'settings-group' : undefined}
      onSubmitCapture={(event) => validateTables(event, invalidPending(draft, keysOf(open)))}
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      {titled && groupTitle(open)}
      {groups[open]()}
      {leftover !== null && <p className="notice notice--error">{say(leftover)}</p>}
      <SaveBar shown={dirty(open)} canSave={!sending && (next !== undefined || keysOf(open).some((key) => draft.adding?.[key] !== undefined))} onRevert={() => revert(keysOf(open))} />
    </form>
    </TableDraft>
  )

  return (
    <div className="page settings-page">
      <header>
        <h1 className="page__title settings-page__title">
          {t.shared.title}
          <HelpTip text={`${t.shared.hint} ${t.shared.elsewhere}`} />
        </h1>
      </header>
      <div className="settings-page__body">
        <SettingsNav groups={GROUPS.map(({ id }) => ({ id, title: titleOf(id) }))} open={open} dirty={(id) => dirty(id as GroupId)} onOpen={setOpen} />
        {open === 'rules' ? (
          // The shared rules and each tracker profile's, under one switcher; a profile's rules are a form of their own.
          <section key={open} className="settings__form settings-page__form" aria-labelledby="settings-group">
            {groupTitle(open)}
            {ruled.length > 0 && (
              // A list, not tabs: a workspace with a dozen tracker profiles does not fit a strip.
              <Row
                className="settings__field"
                label={t.shared.ruleScopes}
                htmlFor="rule-scope"
                control={
                  <Select
                    id="rule-scope"
                    className="settings__text"
                    value={ruledOpen === undefined ? 'rules' : tab}
                    options={[
                      { value: 'rules', label: t.shared.allTrackers, aside: dirty('rules') ? <UnsavedDot /> : undefined },
                      ...ruled.map((profile) => ({
                        value: profileGroup(profile.id),
                        label: profile.name,
                        icon: <TrackerIcon kind={profile.kind} />,
                        aside: Object.keys(profile.rules).length + Object.keys(profile.moves).length > 0 ? <span className="select__note">{t.shared.ownRules}</span> : undefined,
                      })),
                    ]}
                    onChange={setOpen}
                  />
                }
              />
            )}
            {ruledOpen !== undefined ? <ProfileRules key={ruledOpen.id} state={state} profile={ruledOpen} /> : draftForm(false)}
          </section>
        ) : open === 'trackers' || open === 'notices' || open === 'packages' || open === 'stats' ? (
          // Every profile, notice switch and package change is applied on its own, so the tab is not a form; Tally's place and its classifier are applied on their own, ahead of the draft.
          <section key={open} className="settings__form settings-page__form" aria-labelledby="settings-group">
            {groupTitle(open)}
            {open !== 'stats' ? (
              groups[open]()
            ) : (
              <>
                <TallySettings state={state} />
                <ClassifierSettings state={state} />
                {draftForm(false)}
              </>
            )}
          </section>
        ) : (
          draftForm(true)
        )}
      </div>
    </div>
  )
}

/** Offers the skills recent sessions of every project had, besides those already hidden. */
function HiddenSkills({ state, value, onChange }: { state: EvenKeelState; value: string; onChange: (value: string) => void }) {
  const loaded = useToolsViews(state.projects, state.trimTools)
  const known = [...loaded.values()].flatMap((each) =>
    each.state !== 'ready' || each.view === null
      ? []
      : [
          ...(each.view.received?.skills.filter((skill) => skill.source !== 'claudeai').map((skill) => skill.name) ?? []),
          ...each.view.settings.filter((row) => row.kind === 'skill').map((row) => row.name),
        ],
  )
  const suggest = [...new Set(known)].sort((a, b) => a.localeCompare(b))
  return <ListTable field="hiddenSkills" label={t.shared.hiddenSkills} value={value} add={t.shared.hiddenSkillsAdd} empty={t.shared.none} suggest={suggest} mono onChange={onChange} />
}
