import { useEffect, useRef, useState } from 'react'
import { LANGUAGES, type Language } from '../../../src/language.js'
import type { EvenKeelState, SharedForm } from '../../../src/state.js'
import { MODEL_ALIASES, type ModelAlias } from '../../../src/tracker/model.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { FieldNote, linesOf, RestartMark, RuleFields, rulesOf, rulesText, Section, unplaced, useFieldErrors, wholeOf, type RuleTexts } from './settingsParts.js'
import './settings.css'

const MOVE = /\s*=>\s*/

interface Draft {
  parallel: string
  tracker: string
  brief: boolean
  rules: RuleTexts
  model: ModelAlias
  modelPrompts: Record<ModelAlias, string>
  language: Language | ''
  promptLanguage: Language
  hiddenSkills: string
  allowedHosts: string
  window: string
  warn: string
  danger: string
  minTasks: string
  minSessions: string
  days: string
  otherBelow: string
  checkpointTokens: string
  moves: string
}

const draftOf = (form: SharedForm): Draft => ({
  parallel: String(form.parallel),
  tracker: form.tracker,
  brief: form.brief,
  rules: rulesText(form.chain),
  model: form.model,
  modelPrompts: Object.fromEntries(MODEL_ALIASES.map((model) => [model, form.modelPrompts[model] ?? ''])) as Record<ModelAlias, string>,
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
function formOf(draft: Draft): SharedForm | undefined {
  const numbers = [draft.parallel, draft.window, draft.minTasks, draft.minSessions, draft.days].map((text) => wholeOf(text, 0))
  const [warn, danger, otherBelow] = [draft.warn, draft.danger, draft.otherBelow].map(amountOf)
  const checkpointTokens = draft.checkpointTokens.trim() === '' ? null : wholeOf(draft.checkpointTokens, 0)
  const [parallel, window, minTasks, minSessions, days] = numbers
  if (numbers.includes(undefined) || warn === undefined || danger === undefined || otherBelow === undefined || checkpointTokens === undefined) return undefined
  const moves = linesOf(draft.moves).map((line) => line.split(MOVE).map((part) => part.trim()))
  return {
    parallel: parallel!,
    tracker: draft.tracker,
    brief: draft.brief,
    chain: rulesOf(draft.rules),
    model: draft.model,
    modelPrompts: Object.fromEntries(MODEL_ALIASES.flatMap((model) => (draft.modelPrompts[model].trim() === '' ? [] : [[model, draft.modelPrompts[model].trim()]]))),
    language: draft.language === '' ? null : draft.language,
    promptLanguage: draft.promptLanguage,
    hiddenSkills: linesOf(draft.hiddenSkills),
    allowedHosts: linesOf(draft.allowedHosts),
    context: { window: window!, warn, danger },
    stats: {
      compare: { minTasks: minTasks!, minSessions: minSessions!, days: days! },
      moves: Object.fromEntries(moves.map(([from = '', to = '']) => [from, to])),
      otherBelow,
      checkpointTokens,
    },
  }
}
const sameDraft = (a: Draft, b: Draft) => JSON.stringify(formOf(a) ?? a) === JSON.stringify(formOf(b) ?? b)

export function SharedSettings({ state }: { state: EvenKeelState }) {
  const { config, configError } = state
  const { send, sending, failure } = useCommand()
  const saved = draftOf(config.shared)
  const [draft, setDraft] = useState(saved)
  const [done, setDone] = useState(false)
  const previous = useRef(saved)
  const changed = !sameDraft(draft, saved)
  const next = formOf(draft)
  const errorOf = useFieldErrors(null, [failure, configError], config)
  const leftover = unplaced(null, failure, config)

  // The config changed under an untouched form (a save, or the file edited by hand): show the new values.
  useEffect(() => {
    if (sameDraft(previous.current, saved)) return
    if (sameDraft(draft, previous.current)) setDraft(saved)
    previous.current = saved
  })

  const edit = (change: Partial<Draft>) => {
    setDone(false)
    setDraft({ ...draft, ...change })
  }
  const save = async () => {
    if (next === undefined) return
    if (await send('settings', next as unknown as Record<string, unknown>)) setDone(true)
  }
  const number = (field: keyof Draft, label: string, invalid: boolean, wide = false) => (
    <label className="settings__field">
      <span className="settings__label">{label}</span>
      <input
        className={wide ? 'settings__text settings__wide-number' : 'settings__text settings__number'}
        inputMode="numeric"
        value={draft[field] as string}
        aria-invalid={invalid}
        onChange={(event) => edit({ [field]: event.target.value })}
      />
    </label>
  )

  return (
    <div className="page settings-page">
      <header>
        <h1 className="page__title">{t.shared.title}</h1>
        <p className="chain__hint">{t.shared.hint}</p>
        <p className="chain__hint">{t.shared.elsewhere}</p>
      </header>
      <form
        className="settings__form settings-page__form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <Section title={t.shared.chain}>
          <label className="settings__field">
            <span className="settings__label">{t.shared.parallel}</span>
            <span className="settings__hint">{t.shared.parallelHint}</span>
            <input
              className="settings__text settings__number"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={draft.parallel}
              aria-invalid={wholeOf(draft.parallel, 1) === undefined || errorOf('parallel') !== null}
              onChange={(event) => edit({ parallel: event.target.value })}
            />
            <FieldNote error={errorOf('parallel')} />
          </label>
          <label className="settings__field">
            <span className="settings__label">
              {t.shared.tracker}
              <RestartMark on={config.restart.includes('tracker')} />
            </span>
            <select className="settings__text settings__short" value={draft.tracker} onChange={(event) => edit({ tracker: event.target.value })}>
              {config.trackers.map((each) => (
                <option key={each.name} value={each.name}>
                  {each.name}
                </option>
              ))}
            </select>
            <FieldNote error={errorOf('tracker')} />
          </label>
          <div className="settings__field">
            <label className="settings__check">
              <input type="checkbox" checked={draft.brief} onChange={(event) => edit({ brief: event.target.checked })} />
              {t.settings.brief}
            </label>
            <span className="settings__hint">{t.settings.briefHint}</span>
            <FieldNote error={errorOf('brief')} />
          </div>
        </Section>
        <RuleFields texts={draft.rules} onEdit={(rules) => edit({ rules })} errorOf={errorOf} />
        <Section title={t.shared.sessions}>
          <label className="settings__field">
            <span className="settings__label">{t.shared.model}</span>
            <span className="settings__hint">{t.shared.modelHint}</span>
            <select className="settings__text settings__short" value={draft.model} onChange={(event) => edit({ model: event.target.value as ModelAlias })}>
              {MODEL_ALIASES.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <FieldNote error={errorOf('model')} />
          </label>
          <div className="settings__field">
            <span className="settings__label">{t.shared.modelPrompts}</span>
            <span className="settings__hint">{t.shared.modelPromptsHint}</span>
            {MODEL_ALIASES.map((model) => (
              <label key={model} className="settings__field">
                <span className="settings__hint">{model}</span>
                <textarea
                  className="settings__text"
                  rows={2}
                  value={draft.modelPrompts[model]}
                  onChange={(event) => edit({ modelPrompts: { ...draft.modelPrompts, [model]: event.target.value } })}
                />
              </label>
            ))}
            <FieldNote error={errorOf('modelPrompts')} />
          </div>
          <label className="settings__field">
            <span className="settings__label">{t.shared.promptLanguage}</span>
            <select className="settings__text settings__short" value={draft.promptLanguage} onChange={(event) => edit({ promptLanguage: event.target.value as Language })}>
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {t.shared.languages[language]}
                </option>
              ))}
            </select>
            <FieldNote error={errorOf('promptLanguage')} />
          </label>
          <label className="settings__field">
            <span className="settings__label">{t.shared.hiddenSkills}</span>
            <span className="settings__hint">{t.shared.hiddenSkillsHint}</span>
            <textarea
              className="settings__text settings__text--mono"
              rows={6}
              spellCheck={false}
              value={draft.hiddenSkills}
              aria-invalid={errorOf('hiddenSkills') !== null}
              onChange={(event) => edit({ hiddenSkills: event.target.value })}
            />
            <FieldNote error={errorOf('hiddenSkills')} />
          </label>
        </Section>
        <Section title={t.shared.page}>
          <label className="settings__field">
            <span className="settings__label">{t.shared.language}</span>
            <select className="settings__text settings__short" value={draft.language} onChange={(event) => edit({ language: event.target.value as Language | '' })}>
              <option value="">{t.shared.languageAuto}</option>
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {t.shared.languages[language]}
                </option>
              ))}
            </select>
            <FieldNote error={errorOf('language')} />
          </label>
          <label className="settings__field">
            <span className="settings__label">{t.shared.allowedHosts}</span>
            <span className="settings__hint">{t.shared.allowedHostsHint}</span>
            <textarea
              className="settings__text settings__text--mono"
              rows={2}
              spellCheck={false}
              value={draft.allowedHosts}
              placeholder="even-keel.example.com"
              aria-invalid={errorOf('allowedHosts') !== null}
              onChange={(event) => edit({ allowedHosts: event.target.value })}
            />
            <FieldNote error={errorOf('allowedHosts')} />
          </label>
          <div className="settings__field">
            <span className="settings__label">
              {t.shared.context}
              <RestartMark on={config.restart.includes('context')} />
            </span>
            <span className="settings__hint">{t.shared.contextHint}</span>
            <div className="settings__row">
              {number('window', t.shared.contextWindow, wholeOf(draft.window, 1) === undefined, true)}
              {number('warn', t.shared.contextWarn, amountOf(draft.warn) === undefined)}
              {number('danger', t.shared.contextDanger, amountOf(draft.danger) === undefined)}
            </div>
            <FieldNote error={errorOf('context')} />
          </div>
        </Section>
        <Section title={t.shared.stats}>
          <div className="settings__field">
            <span className="settings__hint">{t.shared.compare}</span>
            <div className="settings__row">
              {number('minTasks', t.shared.minTasks, wholeOf(draft.minTasks, 1) === undefined)}
              {number('minSessions', t.shared.minSessions, wholeOf(draft.minSessions, 1) === undefined)}
              {number('days', t.shared.days, wholeOf(draft.days, 1) === undefined)}
            </div>
          </div>
          {number('otherBelow', t.shared.otherBelow, amountOf(draft.otherBelow) === undefined)}
          <label className="settings__field">
            <span className="settings__label">{t.shared.checkpointTokens}</span>
            <span className="settings__hint">{t.shared.checkpointTokensHint}</span>
            <input
              className="settings__text settings__wide-number"
              inputMode="numeric"
              value={draft.checkpointTokens}
              placeholder={t.shared.checkpointTokensPlaceholder}
              aria-invalid={draft.checkpointTokens.trim() !== '' && wholeOf(draft.checkpointTokens, 0) === undefined}
              onChange={(event) => edit({ checkpointTokens: event.target.value })}
            />
          </label>
          <label className="settings__field">
            <span className="settings__label">{t.shared.moves}</span>
            <span className="settings__hint">{t.shared.movesHint}</span>
            <textarea
              className="settings__text settings__text--mono"
              rows={3}
              spellCheck={false}
              value={draft.moves}
              placeholder="D:/old/abc => D:/Projects/abc"
              onChange={(event) => edit({ moves: event.target.value })}
            />
          </label>
          <FieldNote error={errorOf('stats')} />
        </Section>
        <div className="settings__actions">
          <button type="submit" className="button button--primary" disabled={sending || !changed || next === undefined}>
            {t.settings.save}
          </button>
          {done && !changed && <span className="settings__saved">{t.settings.saved}</span>}
        </div>
        {leftover !== null && <p className="notice notice--error">{say(leftover)}</p>}
      </form>
    </div>
  )
}
