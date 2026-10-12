import type { ReactNode } from 'react'
import { LANGUAGES, type Language } from '../../../src/language.js'
import type { EvenKeelState, SharedForm } from '../../../src/state.js'
import { MODEL_ALIASES, type ModelAlias } from '../../../src/tracker/model.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
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
  unplaced,
  useFieldErrors,
  wholeOf,
} from './settingsParts.js'
import { useDraft, useTab } from './settingsStore.js'
import './settings.css'

const MOVE = /\s*=>\s*/
const SCOPE = 'shared'
const promptKey = (model: ModelAlias) => `modelPrompt.${model}`

const GROUPS = [
  { id: 'chain', keys: ['parallel', 'tracker', 'brief', ...RULE_KEYS] },
  { id: 'models', keys: ['model', ...MODEL_ALIASES.map(promptKey), 'promptLanguage'] },
  { id: 'sessions', keys: ['hiddenSkills', 'window', 'warn', 'danger'] },
  { id: 'page', keys: ['language', 'allowedHosts'] },
  { id: 'stats', keys: ['minTasks', 'minSessions', 'days', 'otherBelow', 'checkpointTokens', 'moves'] },
] as const
type GroupId = (typeof GROUPS)[number]['id']
const keysOf = (id: GroupId): readonly string[] => GROUPS.find((group) => group.id === id)!.keys
const same = sameBy(['hiddenSkills', 'allowedHosts', 'moves', ...RULE_KEYS])

const valuesOf = (form: SharedForm): Values => ({
  parallel: String(form.parallel),
  tracker: form.tracker,
  brief: form.brief,
  ...rulesText(form.chain),
  model: form.model,
  ...Object.fromEntries(MODEL_ALIASES.map((model) => [promptKey(model), form.modelPrompts[model] ?? ''])),
  language: form.language ?? '',
  promptLanguage: form.promptLanguage,
  hiddenSkills: form.hiddenSkills.join('\n'),
  allowedHosts: form.allowedHosts.join('\n'),
  window: String(form.context.window),
  warn: String(form.context.warn),
  danger: String(form.context.danger),
  minTasks: String(form.stats.compare.minTasks),
  minSessions: String(form.stats.compare.minSessions),
  days: String(form.stats.compare.days),
  otherBelow: String(form.stats.otherBelow),
  checkpointTokens: form.stats.checkpointTokens === null ? '' : String(form.stats.checkpointTokens),
  moves: Object.entries(form.stats.moves)
    .map(([from, to]) => `${from} => ${to}`)
    .join('\n'),
})

const amountOf = (text: string): number | undefined => (text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : undefined)

/** What the service gets; `undefined` while a number field holds something else. The service judges the ranges. */
function formOf(values: Values): SharedForm | undefined {
  const text = (key: string) => values[key] as string
  const numbers = ['parallel', 'window', 'minTasks', 'minSessions', 'days'].map((key) => wholeOf(text(key), 0))
  const [warn, danger, otherBelow] = ['warn', 'danger', 'otherBelow'].map((key) => amountOf(text(key)))
  const checkpointTokens = text('checkpointTokens').trim() === '' ? null : wholeOf(text('checkpointTokens'), 0)
  const [parallel, window, minTasks, minSessions, days] = numbers
  if (numbers.includes(undefined) || warn === undefined || danger === undefined || otherBelow === undefined || checkpointTokens === undefined) return undefined
  const moves = linesOf(text('moves')).map((line) => line.split(MOVE).map((part) => part.trim()))
  const language = text('language')
  return {
    parallel: parallel!,
    tracker: text('tracker'),
    brief: values.brief as boolean,
    chain: rulesOf(values as Record<(typeof RULE_KEYS)[number], Value>),
    model: text('model') as ModelAlias,
    modelPrompts: Object.fromEntries(MODEL_ALIASES.flatMap((model) => (text(promptKey(model)).trim() === '' ? [] : [[model, text(promptKey(model)).trim()]]))),
    language: language === '' ? null : (language as Language),
    promptLanguage: text('promptLanguage') as Language,
    hiddenSkills: linesOf(text('hiddenSkills')),
    allowedHosts: linesOf(text('allowedHosts')),
    context: { window: window!, warn, danger },
    stats: {
      compare: { minTasks: minTasks!, minSessions: minSessions!, days: days! },
      moves: Object.fromEntries(moves.map(([from = '', to = '']) => [from, to])),
      otherBelow,
      checkpointTokens,
    },
  }
}

export function SharedSettings({ state }: { state: EvenKeelState }) {
  const { config, configError } = state
  const { send, sending, failure } = useCommand()
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

  const edit = (key: string, value: Value) => setDraft(edited(draft, key, value))
  const revert = (keys: readonly string[]) => setDraft(reverted(draft, saved, keys))
  const marks = marksOf(draft, saved, same, revert)
  const save = async () => {
    if (next === undefined || base === undefined) return
    await send('settings', { ...next, base } as unknown as Record<string, unknown>)
  }
  const number = (key: string, label: string, invalid: boolean, wide = false) => (
    <label className={marks.box(key)}>
      <span className="settings__label">{label}</span>
      <input
        className={wide ? 'settings__text settings__wide-number' : 'settings__text settings__number'}
        inputMode="numeric"
        value={text(key)}
        aria-invalid={invalid}
        onChange={(event) => edit(key, event.target.value)}
      />
      {marks.note(key)}
    </label>
  )
  const languageName = (value: Value) => (value === '' ? t.shared.languageAuto : t.shared.languages[value as Language])

  const groups: Record<GroupId, () => ReactNode> = {
    chain: () => (
      <>
        <label className={marks.box('parallel')}>
          <span className="settings__label">{t.shared.parallel}</span>
          <span className="settings__hint">{t.shared.parallelHint}</span>
          <input
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
        </label>
        <label className={marks.box('tracker')}>
          <span className="settings__label">
            {t.shared.tracker}
            <RestartMark on={config.restart.includes('tracker')} />
          </span>
          <select className="settings__text settings__short" value={text('tracker')} onChange={(event) => edit('tracker', event.target.value)}>
            {config.trackers.map((each) => (
              <option key={each.name} value={each.name}>
                {each.name}
              </option>
            ))}
          </select>
          {marks.note('tracker')}
          <FieldNote error={errorOf('tracker')} />
        </label>
        <div className={marks.box('brief')}>
          <label className="settings__check">
            <input type="checkbox" checked={draft.edit.brief as boolean} onChange={(event) => edit('brief', event.target.checked)} />
            {t.settings.brief}
          </label>
          <span className="settings__hint">{t.settings.briefHint}</span>
          {marks.note('brief')}
          <FieldNote error={errorOf('brief')} />
        </div>
        <RuleFields text={text} onEdit={edit} errorOf={errorOf} marks={marks} />
      </>
    ),
    models: () => (
      <>
        <label className={marks.box('model')}>
          <span className="settings__label">{t.shared.model}</span>
          <span className="settings__hint">{t.shared.modelHint}</span>
          <select className="settings__text settings__short" value={text('model')} onChange={(event) => edit('model', event.target.value)}>
            {MODEL_ALIASES.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          {marks.note('model')}
          <FieldNote error={errorOf('model')} />
        </label>
        <div className="settings__field">
          <span className="settings__label">{t.shared.modelPrompts}</span>
          <span className="settings__hint">{t.shared.modelPromptsHint}</span>
          {MODEL_ALIASES.map((model) => (
            <label key={model} className={marks.box(promptKey(model))}>
              <span className="settings__hint">{model}</span>
              <textarea className="settings__text" rows={2} value={text(promptKey(model))} onChange={(event) => edit(promptKey(model), event.target.value)} />
              {marks.note(promptKey(model))}
            </label>
          ))}
          <FieldNote error={errorOf('modelPrompts')} />
        </div>
        <label className={marks.box('promptLanguage')}>
          <span className="settings__label">{t.shared.promptLanguage}</span>
          <select className="settings__text settings__short" value={text('promptLanguage')} onChange={(event) => edit('promptLanguage', event.target.value)}>
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {t.shared.languages[language]}
              </option>
            ))}
          </select>
          {marks.note('promptLanguage', languageName)}
          <FieldNote error={errorOf('promptLanguage')} />
        </label>
      </>
    ),
    sessions: () => (
      <>
        <label className={marks.box('hiddenSkills')}>
          <span className="settings__label">{t.shared.hiddenSkills}</span>
          <span className="settings__hint">{t.shared.hiddenSkillsHint}</span>
          <textarea
            className="settings__text settings__text--mono"
            rows={6}
            spellCheck={false}
            value={text('hiddenSkills')}
            aria-invalid={errorOf('hiddenSkills') !== null}
            onChange={(event) => edit('hiddenSkills', event.target.value)}
          />
          {marks.note('hiddenSkills')}
          <FieldNote error={errorOf('hiddenSkills')} />
        </label>
        <div className="settings__field">
          <span className="settings__label">
            {t.shared.context}
            <RestartMark on={config.restart.includes('context')} />
          </span>
          <span className="settings__hint">{t.shared.contextHint}</span>
          <div className="settings__row">
            {number('window', t.shared.contextWindow, wholeOf(text('window'), 1) === undefined, true)}
            {number('warn', t.shared.contextWarn, amountOf(text('warn')) === undefined)}
            {number('danger', t.shared.contextDanger, amountOf(text('danger')) === undefined)}
          </div>
          <FieldNote error={errorOf('context')} />
        </div>
      </>
    ),
    page: () => (
      <>
        <label className={marks.box('language')}>
          <span className="settings__label">{t.shared.language}</span>
          <select className="settings__text settings__short" value={text('language')} onChange={(event) => edit('language', event.target.value)}>
            <option value="">{t.shared.languageAuto}</option>
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {t.shared.languages[language]}
              </option>
            ))}
          </select>
          {marks.note('language', languageName)}
          <FieldNote error={errorOf('language')} />
        </label>
        <label className={marks.box('allowedHosts')}>
          <span className="settings__label">{t.shared.allowedHosts}</span>
          <span className="settings__hint">{t.shared.allowedHostsHint}</span>
          <textarea
            className="settings__text settings__text--mono"
            rows={2}
            spellCheck={false}
            value={text('allowedHosts')}
            placeholder="even-keel.example.com"
            aria-invalid={errorOf('allowedHosts') !== null}
            onChange={(event) => edit('allowedHosts', event.target.value)}
          />
          {marks.note('allowedHosts')}
          <FieldNote error={errorOf('allowedHosts')} />
        </label>
      </>
    ),
    stats: () => (
      <>
        <div className="settings__field">
          <span className="settings__hint">{t.shared.compare}</span>
          <div className="settings__row">
            {number('minTasks', t.shared.minTasks, wholeOf(text('minTasks'), 1) === undefined)}
            {number('minSessions', t.shared.minSessions, wholeOf(text('minSessions'), 1) === undefined)}
            {number('days', t.shared.days, wholeOf(text('days'), 1) === undefined)}
          </div>
        </div>
        {number('otherBelow', t.shared.otherBelow, amountOf(text('otherBelow')) === undefined)}
        <label className={marks.box('checkpointTokens')}>
          <span className="settings__label">{t.shared.checkpointTokens}</span>
          <span className="settings__hint">{t.shared.checkpointTokensHint}</span>
          <input
            className="settings__text settings__wide-number"
            inputMode="numeric"
            value={text('checkpointTokens')}
            placeholder={t.shared.checkpointTokensPlaceholder}
            aria-invalid={text('checkpointTokens').trim() !== '' && wholeOf(text('checkpointTokens'), 0) === undefined}
            onChange={(event) => edit('checkpointTokens', event.target.value)}
          />
          {marks.note('checkpointTokens', (value) => ((value as string).trim() === '' ? t.shared.checkpointTokensPlaceholder : (value as string)))}
        </label>
        <label className={marks.box('moves')}>
          <span className="settings__label">{t.shared.moves}</span>
          <span className="settings__hint">{t.shared.movesHint}</span>
          <textarea
            className="settings__text settings__text--mono"
            rows={3}
            spellCheck={false}
            value={text('moves')}
            placeholder="D:/old/abc => D:/Projects/abc"
            onChange={(event) => edit('moves', event.target.value)}
          />
          {marks.note('moves')}
        </label>
        <FieldNote error={errorOf('stats')} />
      </>
    ),
  }

  return (
    <div className="page settings-page">
      <header>
        <h1 className="page__title">{t.shared.title}</h1>
        <p className="chain__hint">{t.shared.hint}</p>
        <p className="chain__hint">{t.shared.elsewhere}</p>
      </header>
      <div className="settings-page__body">
        <GroupTabs groups={GROUPS.map(({ id }) => ({ id, title: t.shared[id] }))} open={open} dirty={dirty} onOpen={setOpen} />
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
      </div>
    </div>
  )
}
