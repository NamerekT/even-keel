import { Fragment, useEffect, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { CLI_SOURCES, EXECUTION_MODES } from '../../../src/agent/providers.js'
import { DEFAULT_RULES } from '../../../src/chain/rules.js'
import { CI_KINDS, type CiKind } from '../../../src/ci/model.js'
import { LANGUAGES, type Language } from '../../../src/language.js'
import type { CacheTtl, EvenKeelState, SharedForm } from '../../../src/state.js'
import { offeredProviders } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useToolsViews } from '../tools/useToolsViews.js'
import { Select } from '../ui/Select.js'
import { changed, edited, reverted, sent, type Value, type Values } from './settingsDraft.js'
import {
  FieldHead,
  FieldNote,
  fieldId,
  GroupTabs,
  HelpTip,
  linesOf,
  marksOf,
  minutesOf,
  ProviderGrid,
  Row,
  RULE_KEYS,
  rulesOf,
  rulesText,
  sameBy,
  SaveBar,
  Section,
  SHARE_KEYS,
  shareOf,
  sharesOf,
  sharesText,
  shown,
  SwitchField,
  unplaced,
  useFieldErrors,
  wholeOf,
  type RuleKey,
} from './settingsParts.js'
import { TrackerIcon } from '../ui/icons.js'
import { knownStatuses, originsAt } from './ruleRows.js'
import { MilestoneFields, RuleForm, ruleText } from './RuleForm.js'
import { lineOf, linesText, pairOf, ruleChoicesOf, rowsOf } from './settingsRows.js'
import { accountOptions, namedProviders, providerKeys, providerMap, providerName, providerOptions, providerValues } from './settingsRun.js'
import { ModelOffers } from './ModelOffers.js'
import { profileGroup, ProfileRules } from './ProfileRules.js'
import { profileAddOf } from './pullFix.js'
import { useModels } from './useModels.js'
import { openTab, SHARED_SCOPE, useDraft, useTab } from './settingsStore.js'
import { ListTable, RowsTable } from './settingsTable.js'
import { SettingsNav } from './SettingsNav.js'
import { SettingsProfiles } from './SettingsProfiles.js'
import { ClassifierSettings, PageToken } from './SettingsSecrets.js'
import { TallySettings } from './TallyChoice.js'
import { useVocabularies } from './useVocabularies.js'
import './settings.css'

const SCOPE = SHARED_SCOPE
const EXECUTED = Object.keys(EXECUTION_MODES)

const GROUPS = [
  { id: 'chain', keys: ['parallel', 'brief', 'fillMilestone'] },
  // The connections before the rules over them (BTN-355); a profile is applied on its own and never kept in a draft.
  { id: 'trackers', keys: [] },
  // The shared rules, together with a switch to the rules of each tracker profile, which are saved apart (BTN-66).
  { id: 'rules', keys: [...RULE_KEYS] },
  {
    id: 'models',
    keys: ['provider', ...providerKeys('models'), ...providerKeys('accounts'), ...providerKeys('execution', EXECUTED), ...providerKeys('cli'), 'modelLabels', 'prompt', 'modelPrompts', 'promptLanguage'],
  },
  { id: 'sessions', keys: ['hiddenSkills', 'window', 'warn', 'danger', 'checkpointTokens', ...SHARE_KEYS, 'cacheTtl'] },
  { id: 'ci', keys: ['guard', 'kinds', 'wait', 'recheck', 'fixTask'] },
  { id: 'page', keys: ['language', 'allowedHosts', 'updatesCheck', 'updatesNotify'] },
  { id: 'stats', keys: ['minTasks', 'minSessions', 'days', 'otherBelow', 'moves'] },
] as const
type GroupId = (typeof GROUPS)[number]['id']
const keysOf = (id: GroupId): readonly string[] => GROUPS.find((group) => group.id === id)!.keys
const sameLines = sameBy(['hiddenSkills', 'allowedHosts', 'moves', ...RULE_KEYS])
const same = (key: string, a: Value, b: Value) =>
  key === 'modelPrompts' ? JSON.stringify(promptsOf(a as string)) === JSON.stringify(promptsOf(b as string)) : sameLines(key, a, b)

/** The prompt rows of the draft (a JSON list of `[model, prompt]`), blank ones left out. */
const promptsOf = (text: string): [string, string][] =>
  (JSON.parse(text) as [string, string][]).map(([model, prompt]): [string, string] => [model.trim(), prompt.trim()]).filter(([model, prompt]) => model !== '' && prompt !== '')

const valuesOf = (form: SharedForm): Values => ({
  parallel: String(form.parallel),
  brief: form.brief === null ? '' : String(form.brief),
  ...rulesText(form.chain),
  provider: form.provider,
  ...providerValues('models', form.models),
  ...providerValues('accounts', form.accounts),
  ...providerValues('execution', form.execution, EXECUTED),
  ...providerValues('cli', form.cli),
  modelLabels: form.modelLabels,
  modelPrompts: JSON.stringify(Object.entries(form.modelPrompts)),
  prompt: form.prompt ?? '',
  language: form.language ?? '',
  promptLanguage: form.promptLanguage,
  hiddenSkills: form.hiddenSkills.join('\n'),
  cacheTtl: form.cacheTtl ?? '',
  allowedHosts: form.allowedHosts.join('\n'),
  window: String(form.context.window),
  warn: String(form.context.warn),
  danger: String(form.context.danger),
  minTasks: String(form.stats.compare.minTasks),
  minSessions: String(form.stats.compare.minSessions),
  days: String(form.stats.compare.days),
  otherBelow: String(form.stats.otherBelow),
  checkpointTokens: form.stats.checkpointTokens === null ? '' : String(form.stats.checkpointTokens),
  ...sharesText(form.stats.checkpointShares),
  moves: linesText(Object.entries(form.stats.moves).map(lineOf)),
  updatesCheck: form.updates.check,
  updatesNotify: form.updates.notify,
  fillMilestone: form.fillMilestone,
  guard: form.ci.guard,
  kinds: form.ci.kinds,
  wait: form.ci.waitMinutes === null ? '' : String(form.ci.waitMinutes),
  recheck: form.ci.recheckMain,
  fixTask: form.ci.fixTask,
})

const amountOf = (text: string): number | undefined => (text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : undefined)

/** What the service gets; `undefined` while a number field holds something else, or a moved folder lacks a side. The service judges the ranges. */
function formOf(values: Values): SharedForm | undefined {
  const text = (key: string) => values[key] as string
  const numbers = ['parallel', 'window', 'minTasks', 'minSessions', 'days'].map((key) => wholeOf(text(key), 0))
  const [warn, danger, otherBelow] = ['warn', 'danger', 'otherBelow'].map((key) => amountOf(text(key)))
  const checkpointTokens = text('checkpointTokens').trim() === '' ? null : wholeOf(text('checkpointTokens'), 0)
  const waitMinutes = minutesOf(text('wait'))
  const [parallel, window, minTasks, minSessions, days] = numbers
  const moves = linesOf(text('moves')).map(pairOf)
  const checkpointShares = sharesOf(values)
  if (numbers.includes(undefined) || warn === undefined || danger === undefined || otherBelow === undefined || checkpointTokens === undefined || waitMinutes === undefined) return undefined
  if (checkpointShares === undefined) return undefined
  if (moves.some(([from, to]) => from === '' || to === '')) return undefined
  const language = text('language')
  return {
    parallel: parallel!,
    brief: text('brief') === '' ? null : text('brief') === 'true',
    chain: rulesOf(values as Record<(typeof RULE_KEYS)[number], Value>),
    provider: text('provider'),
    models: providerMap('models', values),
    accounts: providerMap('accounts', values),
    execution: providerMap('execution', values, EXECUTED),
    cli: providerMap('cli', values),
    modelLabels: values.modelLabels as boolean,
    modelPrompts: Object.fromEntries(promptsOf(text('modelPrompts'))),
    prompt: text('prompt').trim() === '' ? null : text('prompt'),
    language: language === '' ? null : (language as Language),
    promptLanguage: text('promptLanguage') as Language,
    hiddenSkills: linesOf(text('hiddenSkills')),
    cacheTtl: text('cacheTtl') === '' ? null : (text('cacheTtl') as CacheTtl),
    allowedHosts: linesOf(text('allowedHosts')),
    context: { window: window!, warn, danger },
    stats: {
      compare: { minTasks: minTasks!, minSessions: minSessions!, days: days! },
      moves: Object.fromEntries(moves),
      otherBelow,
      checkpointTokens,
      checkpointShares,
    },
    updates: { check: values.updatesCheck as boolean, notify: values.updatesNotify as boolean },
    ci: {
      guard: values.guard as boolean,
      kinds: CI_KINDS.filter((kind) => (values.kinds as readonly string[]).includes(kind)),
      waitMinutes,
      recheckMain: values.recheck as boolean,
      fixTask: values.fixTask as boolean,
    },
    fillMilestone: values.fillMilestone as boolean,
  }
}

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
  // A link asking for a profile (PR mode, EKR-7) lands on the tab its dialog opens in.
  useEffect(() => {
    if (addsProfile) openTab(SCOPE, 'trackers')
  }, [addsProfile])
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
  const modelOffers = useModels(offered.map((provider) => text(`accounts.${provider}`)))
  const titleOf = (id: GroupId) => t.shared[id]
  const hintOf: Partial<Record<GroupId, string>> = { ci: t.shared.ciNote }
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
  const save = async () => {
    if (next === undefined || base === undefined) return
    await send('settings', { ...next, base } as unknown as Record<string, unknown>)
  }
  const numberInput = (key: string, invalid: boolean, extra: { placeholder?: string; disabled?: boolean } = {}) => (
    <input
      id={fieldId(key)}
      className="settings__text settings__number"
      inputMode="numeric"
      value={text(key)}
      placeholder={extra.placeholder}
      disabled={extra.disabled}
      aria-invalid={invalid}
      onChange={(event) => edit(key, event.target.value)}
    />
  )
  // A number among others of one setting: its name above it.
  const number = (key: string, label: string, invalid: boolean) => (
    <div className={marks.box(key)}>
      <FieldHead label={label} htmlFor={fieldId(key)} />
      {numberInput(key, invalid)}
      {marks.note(key)}
    </div>
  )
  const numberRow = (key: string, label: string, invalid: boolean, hint?: string) => (
    <Row className={marks.box(key)} label={label} hint={hint} htmlFor={fieldId(key)} control={numberInput(key, invalid)}>
      {marks.note(key)}
      <FieldNote error={errorOf(key)} />
    </Row>
  )
  const select = (key: string, label: string, options: readonly { value: string; label: string }[], hint?: string) => (
    <Row
      className={marks.box(key)}
      label={label}
      hint={hint}
      htmlFor={fieldId(key)}
      control={<Select id={fieldId(key)} className="settings__text" value={text(key)} options={options} onChange={(value) => edit(key, value)} />}
    >
      {marks.note(key, (value) => options.find((option) => option.value === value)?.label ?? String(value))}
      <FieldNote error={errorOf(key)} />
    </Row>
  )
  // A model and a pick in a cell of the provider table: its column names it. The model is typed freely, the account's list only offered.
  const model = (key: string, label: string, offers: readonly string[]) => (
    <div className={marks.box(key)}>
      <input
        id={fieldId(key)}
        className="settings__text settings__text--mono"
        aria-label={label}
        spellCheck={false}
        value={text(key)}
        placeholder={t.settings.cliDefault}
        aria-invalid={errorOf(key) !== null}
        list={offers.length === 0 ? undefined : `${fieldId(key)}-models`}
        onChange={(event) => edit(key, event.target.value)}
      />
      <ModelOffers id={`${fieldId(key)}-models`} models={offers} />
      {marks.note(key, (value) => ((value as string).trim() === '' ? t.settings.cliDefault : (value as string)))}
      <FieldNote error={errorOf(key)} />
    </div>
  )
  const pick = (key: string, label: string, options: readonly { value: string; label: string }[]) => (
    <div className={marks.box(key)}>
      <Select id={fieldId(key)} className="settings__text" label={label} value={text(key)} options={options} onChange={(value) => edit(key, value)} />
      {marks.note(key, (value) => options.find((option) => option.value === value)?.label ?? String(value))}
      <FieldNote error={errorOf(key)} />
    </div>
  )
  const check = (key: string, label: string, hint: string, disabled = false, error = key) => (
    <SwitchField className={marks.box(key)} label={label} hint={hint} checked={draft.edit[key] as boolean} disabled={disabled} onChange={(on) => edit(key, on)}>
      {marks.note(key)}
      <FieldNote error={errorOf(error)} />
    </SwitchField>
  )
  const kinds = draft.edit.kinds as readonly CiKind[]
  const unguarded = !(draft.edit.guard as boolean)
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
          modelLabels={draft.edit.modelLabels as boolean}
          onEdit={(changes) => editAll(changes.map(([key, value]) => [key, ruleText(value)]))}
          errorOf={errorOf}
          marks={marks}
        />
        <Section title={t.settings.milestones} hint={t.settings.milestonesHint}>
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
          {select('provider', t.settings.provider, providerOptions(offered), t.shared.providerHint)}
          <ProviderGrid
            columns={[
              { key: 'models', label: t.settings.model, hint: t.shared.modelHint },
              { key: 'accounts', label: t.settings.account, hint: t.shared.accountHint },
              { key: 'execution', label: t.shared.execution, hint: t.shared.executionHint },
              { key: 'cli', label: t.shared.cli, hint: t.shared.cliHint },
            ]}
            providers={offered}
            cell={(column, provider) => {
              const name = providerName(provider)
              if (column === 'models') return model(`models.${provider}`, t.settings.modelOf(name), modelOffers[text(`accounts.${provider}`)] ?? [])
              if (column === 'accounts') return pick(`accounts.${provider}`, t.settings.accountOf(name), accountOptions(state.account, provider, text(`accounts.${provider}`)))
              if (column === 'cli')
                return pick(
                  `cli.${provider}`,
                  t.shared.cliOf(name),
                  CLI_SOURCES.map((source) => ({ value: source, label: t.shared.cliSources[source] ?? source })),
                )
              const modes = EXECUTION_MODES[provider]
              return modes === undefined
                ? null
                : pick(
                    `execution.${provider}`,
                    t.shared.executionOf(name),
                    modes.map((mode) => ({ value: mode, label: t.shared.modes[mode] ?? mode })),
                  )
            }}
          />
        </Section>
        <Section title={t.shared.sections.prompts}>
          {check('modelLabels', t.settings.modelLabels, t.shared.modelLabelsHint)}
          <div className={marks.box('prompt')}>
            <FieldHead label={t.settings.prompt} hint={t.shared.promptHint} htmlFor={fieldId('prompt')} />
            <textarea
              id={fieldId('prompt')}
              className="settings__text"
              rows={5}
              value={text('prompt')}
              placeholder={t.shared.promptPlaceholder}
              onChange={(event) => edit('prompt', event.target.value)}
            />
            {marks.note('prompt', (value) => ((value as string).trim() === '' ? t.shared.none : (value as string)))}
            <FieldNote error={errorOf('prompt')} />
          </div>
          <div className={marks.box('modelPrompts')}>
            <FieldHead label={t.shared.modelPrompts} hint={t.shared.modelPromptsHint} />
            <ModelPrompts value={text('modelPrompts')} onChange={(value) => edit('modelPrompts', value)} />
            {marks.note('modelPrompts', (value) => promptsOf(value as string).map(([name]) => name).join(', ') || t.shared.none)}
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
            <FieldHead label={t.shared.hiddenSkills} hint={t.shared.hiddenSkillsHint} />
            <HiddenSkills state={state} value={text('hiddenSkills')} onChange={(value) => edit('hiddenSkills', value)} />
            {marks.note('hiddenSkills')}
            <FieldNote error={errorOf('hiddenSkills')} />
          </div>
        </Section>
        <Section title={t.shared.sections.context}>
          <div className="settings__field">
            <FieldHead label={t.shared.context} hint={t.shared.contextHint} />
            <div className="settings__row">
              {number('window', t.shared.contextWindow, wholeOf(text('window'), 1) === undefined)}
              {number('warn', t.shared.contextWarn, amountOf(text('warn')) === undefined)}
              {number('danger', t.shared.contextDanger, amountOf(text('danger')) === undefined)}
            </div>
            <FieldNote error={errorOf('context')} />
          </div>
          <Row
            className={marks.box('checkpointTokens')}
            label={t.shared.checkpointTokens}
            hint={t.shared.checkpointTokensHint}
            htmlFor={fieldId('checkpointTokens')}
            control={numberInput('checkpointTokens', text('checkpointTokens').trim() !== '' && wholeOf(text('checkpointTokens'), 0) === undefined, {
              placeholder: t.shared.checkpointTokensPlaceholder,
            })}
          >
            {marks.note('checkpointTokens', (value) => ((value as string).trim() === '' ? t.shared.checkpointTokensPlaceholder : (value as string)))}
            <FieldNote error={errorOf('checkpointTokens')} />
          </Row>
          <div className="settings__field">
            <FieldHead label={t.shared.checkpointShares} hint={t.shared.checkpointSharesHint} />
            <div className="settings__row">
              {SHARE_KEYS.map((key) => (
                <Fragment key={key}>{number(key, t.shared[key], shareOf(text(key)) === undefined)}</Fragment>
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
        </Section>
      </>
    ),
    ci: () => (
      <Section title={t.settings.sections.guard}>
        {check('guard', t.settings.guard, t.settings.guardHint)}
        <div className={unguarded ? 'settings__guarded settings__guarded--off' : 'settings__guarded'}>
          <fieldset className={marks.box('kinds', 'settings__field settings__group')}>
            <legend>
              <FieldHead label={t.settings.ci} hint={t.settings.ciHint} />
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
            {marks.note('kinds', (value) => shown((value as CiKind[]).map((kind) => t.settings.ciKinds[kind])))}
            <FieldNote error={errorOf('ci')} />
          </fieldset>
          <Row
            className={marks.box('wait')}
            label={t.settings.ciWait}
            hint={t.settings.ciWaitHint}
            htmlFor={fieldId('wait')}
            control={numberInput('wait', minutesOf(text('wait')) === undefined, { placeholder: t.settings.ciWaitPlaceholder, disabled: unguarded })}
          >
            {marks.note('wait', (value) => ((value as string).trim() === '' ? t.settings.ciWaitPlaceholder : shown(value)))}
          </Row>
          {check('recheck', t.settings.recheckMain, t.settings.recheckMainHint, unguarded)}
          {check('fixTask', t.settings.fixTask, t.settings.fixTaskHint, unguarded)}
        </div>
      </Section>
    ),
    page: () => (
      <>
        <Section title={t.shared.sections.interface}>
          {select('language', t.shared.language, [{ value: '', label: t.shared.languageAuto }, ...languages])}
          {check('updatesCheck', t.shared.updatesCheck, t.shared.updatesCheckHint, false, 'updates')}
          {check('updatesNotify', t.shared.updatesNotify, t.shared.updatesNotifyHint)}
        </Section>
        <Section title={t.shared.sections.access}>
          <PageToken state={state} />
          <div className={marks.box('allowedHosts')}>
            <FieldHead label={t.shared.allowedHosts} hint={t.shared.allowedHostsHint} />
            <ListTable
              label={t.shared.allowedHosts}
              value={text('allowedHosts')}
              add={t.shared.allowedHostsAdd}
              empty={t.shared.allowedHostsEmpty}
              mono
              onChange={(value) => edit('allowedHosts', value)}
            />
            {marks.note('allowedHosts')}
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
            <FieldHead label={t.shared.moves} hint={t.shared.movesHint} />
            <RowsTable
              label={t.shared.moves}
              columns={[
                { title: t.shared.movesFrom, placeholder: 'D:/old/abc', mono: true },
                { title: t.shared.movesTo, placeholder: 'D:/Projects/abc', mono: true },
              ]}
              rows={rowsOf(text('moves')).map(pairOf)}
              empty={t.shared.none}
              onChange={(rows) => edit('moves', linesText(rows.map(lineOf)))}
            />
            {marks.note('moves')}
          </div>
          <FieldNote error={errorOf('stats')} />
        </Section>
      </>
    ),
    trackers: () => <SettingsProfiles state={state} onRules={(id) => setOpen(profileGroup(id))} />,
  }

  const draftForm = (titled: boolean) => (
    <form
      key={open}
      className={titled ? 'settings__form settings-page__form' : 'settings__form'}
      aria-labelledby={titled ? 'settings-group' : undefined}
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      {titled && groupTitle(open)}
      {groups[open]()}
      {leftover !== null && <p className="notice notice--error">{say(leftover)}</p>}
      <SaveBar shown={dirty(open)} canSave={!sending && next !== undefined} onRevert={() => revert(keysOf(open))} />
    </form>
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
              <GroupTabs
                label={t.shared.ruleScopes}
                groups={[
                  { id: 'rules', title: t.shared.allTrackers },
                  ...ruled.map((profile) => ({
                    id: profileGroup(profile.id),
                    title: (
                      <>
                        <TrackerIcon kind={profile.kind} />
                        {profile.name}
                      </>
                    ),
                  })),
                ]}
                open={ruledOpen === undefined ? 'rules' : tab}
                dirty={(id) => id === 'rules' && dirty('rules')}
                onOpen={setOpen}
              />
            )}
            {ruledOpen !== undefined ? <ProfileRules key={ruledOpen.id} state={state} profile={ruledOpen} /> : draftForm(false)}
          </section>
        ) : open === 'trackers' || open === 'stats' ? (
          // Every profile is applied on its own, so the tab is not a form; Tally's place and its classifier are applied on their own, ahead of the draft.
          <section key={open} className="settings__form settings-page__form" aria-labelledby="settings-group">
            {groupTitle(open)}
            {open === 'trackers' ? (
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

/** A row per model with a prompt, in the order they were added; a row cleared while typing stays until its bin. */
function ModelPrompts({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <RowsTable
      label={t.shared.modelPrompts}
      columns={[
        { title: t.shared.promptModel, placeholder: 'opus', mono: true, width: '11em' },
        { title: t.shared.promptText, placeholder: t.shared.promptAdd, multiline: true },
      ]}
      rows={JSON.parse(value) as string[][]}
      empty={t.shared.none}
      onChange={(rows) => onChange(JSON.stringify(rows))}
    />
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
  return <ListTable label={t.shared.hiddenSkills} value={value} add={t.shared.hiddenSkillsAdd} empty={t.shared.none} suggest={suggest} mono onChange={onChange} />
}
