import type { ReactNode } from 'react'
import { EXECUTION_MODES, PROVIDERS } from '../../../src/agent/providers.js'
import { LANGUAGES, type Language } from '../../../src/language.js'
import type { CacheTtl, EvenKeelState, SharedForm } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useToolsViews } from '../tools/useToolsViews.js'
import { Select } from '../ui/Select.js'
import { changed, edited, reverted, sent, type Value, type Values } from './settingsDraft.js'
import {
  CheckField,
  FieldHead,
  FieldNote,
  fieldId,
  HelpTip,
  linesOf,
  marksOf,
  ProviderGrid,
  RULE_KEYS,
  RuleFields,
  rulesOf,
  rulesText,
  sameBy,
  SaveBar,
  unplaced,
  useFieldErrors,
  wholeOf,
} from './settingsParts.js'
import { lineOf, linesText, pairOf, ruleChoicesOf, rowsOf } from './settingsRows.js'
import { accountOptions, providerKeys, providerMap, providerName, providerOptions, providerValues } from './settingsRun.js'
import { useDraft, useTab } from './settingsStore.js'
import { ListTable, RowsTable } from './settingsTable.js'
import { SettingsNav } from './SettingsNav.js'
import './settings.css'

const SCOPE = 'shared'
const EXECUTED = Object.keys(EXECUTION_MODES)

const GROUPS = [
  { id: 'chain', keys: ['parallel', 'tracker', 'brief', ...RULE_KEYS] },
  {
    id: 'models',
    keys: ['provider', ...providerKeys('models'), ...providerKeys('accounts'), ...providerKeys('execution', EXECUTED), 'modelLabels', 'modelPrompts', 'promptLanguage'],
  },
  { id: 'sessions', keys: ['hiddenSkills', 'window', 'warn', 'danger', 'checkpointTokens'] },
  { id: 'claude', keys: ['cacheTtl'] },
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
  tracker: form.tracker,
  brief: form.brief,
  ...rulesText(form.chain),
  provider: form.provider,
  ...providerValues('models', form.models),
  ...providerValues('accounts', form.accounts),
  ...providerValues('execution', form.execution, EXECUTED),
  modelLabels: form.modelLabels,
  modelPrompts: JSON.stringify(Object.entries(form.modelPrompts)),
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
  moves: linesText(Object.entries(form.stats.moves).map(lineOf)),
  updatesCheck: form.updates.check,
  updatesNotify: form.updates.notify,
})

const amountOf = (text: string): number | undefined => (text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : undefined)

/** What the service gets; `undefined` while a number field holds something else, or a moved folder lacks a side. The service judges the ranges. */
function formOf(values: Values): SharedForm | undefined {
  const text = (key: string) => values[key] as string
  const numbers = ['parallel', 'window', 'minTasks', 'minSessions', 'days'].map((key) => wholeOf(text(key), 0))
  const [warn, danger, otherBelow] = ['warn', 'danger', 'otherBelow'].map((key) => amountOf(text(key)))
  const checkpointTokens = text('checkpointTokens').trim() === '' ? null : wholeOf(text('checkpointTokens'), 0)
  const [parallel, window, minTasks, minSessions, days] = numbers
  const moves = linesOf(text('moves')).map(pairOf)
  if (numbers.includes(undefined) || warn === undefined || danger === undefined || otherBelow === undefined || checkpointTokens === undefined) return undefined
  if (moves.some(([from, to]) => from === '' || to === '')) return undefined
  const language = text('language')
  return {
    parallel: parallel!,
    tracker: text('tracker'),
    brief: values.brief as boolean,
    chain: rulesOf(values as Record<(typeof RULE_KEYS)[number], Value>),
    provider: text('provider'),
    models: providerMap('models', values),
    accounts: providerMap('accounts', values),
    execution: providerMap('execution', values, EXECUTED),
    modelLabels: values.modelLabels as boolean,
    modelPrompts: Object.fromEntries(promptsOf(text('modelPrompts'))),
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
    },
    updates: { check: values.updatesCheck as boolean, notify: values.updatesNotify as boolean },
  }
}

export function SharedSettings({ state }: { state: EvenKeelState }) {
  const { config, configError } = state
  const { send, sending, failure } = useCommand()
  const modes = useCommand()
  const saved = valuesOf(config.shared)
  const [current, setDraft] = useDraft(SCOPE, saved, same)
  const draft = current!
  const [open, setOpen] = useTab<GroupId>(SCOPE, 'chain')
  const dirty = (id: GroupId) => changed(draft, keysOf(id), same).length > 0
  const outgoing = sent(draft, keysOf(open))
  const next = formOf(outgoing.form)
  const base = formOf(outgoing.base)
  const errorOf = useFieldErrors(null, [failure, configError], config)
  const leftover = unplaced(null, failure, config)
  const text = (key: string) => draft.edit[key] as string
  const titleOf = (id: GroupId) => t.shared[id]

  const edit = (key: string, value: Value) => setDraft(edited(draft, key, value))
  const revert = (keys: readonly string[]) => setDraft(reverted(draft, saved, keys))
  const marks = marksOf(draft, saved, same, revert)
  const save = async () => {
    if (next === undefined || base === undefined) return
    await send('settings', { ...next, base } as unknown as Record<string, unknown>)
  }
  const number = (key: string, label: string, invalid: boolean, hint?: string) => (
    <div className={marks.box(key)}>
      <FieldHead label={label} hint={hint} htmlFor={fieldId(key)} />
      <input
        id={fieldId(key)}
        className="settings__text settings__number"
        inputMode="numeric"
        value={text(key)}
        aria-invalid={invalid}
        onChange={(event) => edit(key, event.target.value)}
      />
      {marks.note(key)}
    </div>
  )
  const select = (key: string, label: string, options: readonly { value: string; label: string }[], hint?: string) => (
    <div className={marks.box(key)}>
      <FieldHead label={label} hint={hint} htmlFor={fieldId(key)} />
      <Select id={fieldId(key)} className="settings__text settings__short" value={text(key)} options={options} onChange={(value) => edit(key, value)} />
      {marks.note(key, (value) => options.find((option) => option.value === value)?.label ?? String(value))}
      <FieldNote error={errorOf(key)} />
    </div>
  )
  // A model and a pick in a cell of the provider table: its column names it.
  const model = (key: string, label: string) => (
    <div className={marks.box(key)}>
      <input
        id={fieldId(key)}
        className="settings__text settings__text--mono"
        aria-label={label}
        spellCheck={false}
        value={text(key)}
        placeholder={t.settings.cliDefault}
        aria-invalid={errorOf(key) !== null}
        onChange={(event) => edit(key, event.target.value)}
      />
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
  const languages = LANGUAGES.map((language) => ({ value: language, label: t.shared.languages[language] }))

  const modesFailure = modes.failure !== null && <p className="notice notice--error">{say(modes.failure)}</p>

  const groups: Record<GroupId, () => ReactNode> = {
    chain: () => (
      <>
        <CheckField
          className="settings__field"
          label={t.status.unattended}
          hint={t.status.unattendedHint}
          checked={state.unattended}
          disabled={modes.sending}
          onChange={(on) => void modes.send('chain/unattended', { on })}
        />
        {modesFailure}
        <div className={marks.box('parallel')}>
          <FieldHead label={t.shared.parallel} hint={t.shared.parallelHint} htmlFor={fieldId('parallel')} />
          <input
            id={fieldId('parallel')}
            className="settings__text settings__number"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={text('parallel')}
            aria-invalid={wholeOf(text('parallel'), 1) === undefined || errorOf('parallel') !== null}
            onChange={(event) => edit('parallel', event.target.value)}
          />
          {marks.note('parallel')}
          <FieldNote error={errorOf('parallel')} />
        </div>
        {select(
          'tracker',
          t.shared.tracker,
          config.trackers.map((each) => ({ value: each.name, label: each.name })),
          t.shared.trackerHint,
        )}
        <CheckField className={marks.box('brief')} label={t.settings.brief} hint={t.settings.briefHint} checked={draft.edit.brief as boolean} onChange={(on) => edit('brief', on)}>
          {marks.note('brief')}
          <FieldNote error={errorOf('brief')} />
        </CheckField>
        <RuleFields text={text} onEdit={edit} errorOf={errorOf} marks={marks} choices={ruleChoicesOf(state.tasks)} />
      </>
    ),
    models: () => (
      <>
        {select('provider', t.settings.provider, providerOptions(), t.shared.providerHint)}
        <ProviderGrid
          columns={[
            { key: 'models', label: t.settings.model, hint: t.shared.modelHint },
            { key: 'accounts', label: t.settings.account, hint: t.shared.accountHint },
            { key: 'execution', label: t.shared.execution, hint: t.shared.executionHint },
          ]}
          providers={PROVIDERS}
          cell={(column, provider) => {
            const name = providerName(provider)
            if (column === 'models') return model(`models.${provider}`, t.settings.modelOf(name))
            if (column === 'accounts') return pick(`accounts.${provider}`, t.settings.accountOf(name), accountOptions(state.account, provider, text(`accounts.${provider}`)))
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
        <CheckField
          className={marks.box('modelLabels')}
          label={t.settings.modelLabels}
          hint={t.shared.modelLabelsHint}
          checked={draft.edit.modelLabels as boolean}
          onChange={(on) => edit('modelLabels', on)}
        >
          {marks.note('modelLabels')}
          <FieldNote error={errorOf('modelLabels')} />
        </CheckField>
        <div className={marks.box('modelPrompts')}>
          <FieldHead label={t.shared.modelPrompts} hint={t.shared.modelPromptsHint} />
          <ModelPrompts value={text('modelPrompts')} onChange={(value) => edit('modelPrompts', value)} />
          {marks.note('modelPrompts', (value) => promptsOf(value as string).map(([name]) => name).join(', ') || t.shared.none)}
          <FieldNote error={errorOf('modelPrompts')} />
        </div>
        {select('promptLanguage', t.shared.promptLanguage, languages)}
      </>
    ),
    sessions: () => (
      <>
        <CheckField
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
        <div className="settings__field">
          <FieldHead label={t.shared.context} hint={t.shared.contextHint} />
          <div className="settings__row">
            {number('window', t.shared.contextWindow, wholeOf(text('window'), 1) === undefined)}
            {number('warn', t.shared.contextWarn, amountOf(text('warn')) === undefined)}
            {number('danger', t.shared.contextDanger, amountOf(text('danger')) === undefined)}
          </div>
          <FieldNote error={errorOf('context')} />
        </div>
        <div className={marks.box('checkpointTokens')}>
          <FieldHead label={t.shared.checkpointTokens} hint={t.shared.checkpointTokensHint} htmlFor={fieldId('checkpointTokens')} />
          <input
            id={fieldId('checkpointTokens')}
            className="settings__text settings__number"
            inputMode="numeric"
            value={text('checkpointTokens')}
            placeholder={t.shared.checkpointTokensPlaceholder}
            aria-invalid={text('checkpointTokens').trim() !== '' && wholeOf(text('checkpointTokens'), 0) === undefined}
            onChange={(event) => edit('checkpointTokens', event.target.value)}
          />
          {marks.note('checkpointTokens', (value) => ((value as string).trim() === '' ? t.shared.checkpointTokensPlaceholder : (value as string)))}
          <FieldNote error={errorOf('checkpointTokens')} />
        </div>
      </>
    ),
    claude: () =>
      select(
        'cacheTtl',
        t.shared.cacheTtl,
        [
          { value: '', label: t.shared.cacheTtlAuto },
          { value: '5m', label: t.shared.cacheTtl5m },
          { value: '1h', label: t.shared.cacheTtl1h },
        ],
        t.shared.cacheTtlHint,
      ),
    page: () => (
      <>
        {select('language', t.shared.language, [{ value: '', label: t.shared.languageAuto }, ...languages])}
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
        <CheckField
          className={marks.box('updatesCheck')}
          label={t.shared.updatesCheck}
          hint={t.shared.updatesCheckHint}
          checked={draft.edit.updatesCheck as boolean}
          onChange={(on) => edit('updatesCheck', on)}
        >
          {marks.note('updatesCheck')}
          <FieldNote error={errorOf('updates')} />
        </CheckField>
        <CheckField
          className={marks.box('updatesNotify')}
          label={t.shared.updatesNotify}
          hint={t.shared.updatesNotifyHint}
          checked={draft.edit.updatesNotify as boolean}
          onChange={(on) => edit('updatesNotify', on)}
        >
          {marks.note('updatesNotify')}
        </CheckField>
      </>
    ),
    stats: () => (
      <>
        <div className="settings__field">
          <FieldHead label={t.shared.compare} hint={t.shared.compareHint} />
          <div className="settings__row">
            {number('minTasks', t.shared.minTasks, wholeOf(text('minTasks'), 1) === undefined)}
            {number('minSessions', t.shared.minSessions, wholeOf(text('minSessions'), 1) === undefined)}
            {number('days', t.shared.days, wholeOf(text('days'), 1) === undefined)}
          </div>
        </div>
        {number('otherBelow', t.shared.otherBelow, amountOf(text('otherBelow')) === undefined, t.shared.otherBelowHint)}
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
      </>
    ),
  }

  return (
    <div className="page settings-page">
      <header>
        <h1 className="page__title settings-page__title">
          {t.shared.title}
          <HelpTip text={`${t.shared.hint} ${t.shared.elsewhere}`} />
        </h1>
      </header>
      <div className="settings-page__body">
        <SettingsNav groups={GROUPS.map(({ id }) => ({ id, title: titleOf(id) }))} open={open} dirty={dirty} onOpen={setOpen} />
        <form
          key={open}
          className="settings__form settings-page__form"
          aria-labelledby="settings-group"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <h2 id="settings-group" className="settings-page__group">
            {titleOf(open)}
          </h2>
          {groups[open]()}
          {leftover !== null && <p className="notice notice--error">{say(leftover)}</p>}
          {dirty(open) && <SaveBar canSave={!sending && next !== undefined} onRevert={() => revert(keysOf(open))} />}
        </form>
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
