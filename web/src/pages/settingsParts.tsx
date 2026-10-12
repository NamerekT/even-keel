import type { ReactNode } from 'react'
import type { ChainRules } from '../../../src/chain/rules.js'
import type { Notice } from '../../../src/notice/notice.js'
import type { ConfigView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { fieldOf } from './settingsField.js'

export const RULE_KEYS = ['active', 'terminal', 'requiredLabels', 'excludedLabels'] as const
export type RuleKey = (typeof RULE_KEYS)[number]
export type RuleTexts = Record<RuleKey, string>

export const linesOf = (text: string) => text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
export const rulesText = (rules: ChainRules): RuleTexts => ({
  active: (rules.active ?? []).join('\n'),
  terminal: (rules.terminal ?? []).join('\n'),
  requiredLabels: rules.requiredLabels.join('\n'),
  excludedLabels: rules.excludedLabels.join('\n'),
})
/** An empty status list goes by the categories of the statuses, as the service stores it. */
export const rulesOf = (texts: RuleTexts): ChainRules => {
  const statuses = (text: string) => (linesOf(text).length === 0 ? null : linesOf(text))
  return { active: statuses(texts.active), terminal: statuses(texts.terminal), requiredLabels: linesOf(texts.requiredLabels), excludedLabels: linesOf(texts.excludedLabels) }
}

/** A whole number from `min` on; `undefined` — not one. */
export const wholeOf = (text: string, min: number): number | undefined => {
  const value = Number(text)
  return text.trim() !== '' && Number.isInteger(value) && value >= min ? value : undefined
}

/** The error of a field of this form: the failed save first, then the file's own error, if either points at the field. */
export function useFieldErrors(project: string | null, errors: (Notice | null)[], config: ConfigView): (field: string) => Notice | null {
  const keys = config.trackers.flatMap((tracker) => (tracker.projectKey === null ? [] : [tracker.projectKey.key]))
  const placed = errors.flatMap((error) => {
    const at = error === null ? null : fieldOf(error, keys)
    return at !== null && at.project === project ? [{ field: at.field, error: error! }] : []
  })
  return (field) => placed.find((each) => each.field === field)?.error ?? null
}

/** The errors no field of this form shows. */
export function unplaced(project: string | null, error: Notice | null, config: ConfigView): Notice | null {
  if (error === null) return null
  const keys = config.trackers.flatMap((tracker) => (tracker.projectKey === null ? [] : [tracker.projectKey.key]))
  const at = fieldOf(error, keys)
  return at !== null && at.project === project ? null : error
}

export function RestartMark({ on }: { on: boolean }) {
  return on ? <span className="settings__restart">{t.settings.restart}</span> : null
}

export function FieldNote({ error }: { error: Notice | null }) {
  return error === null ? null : (
    <span className="settings__error" role="alert">
      {say(error)}
    </span>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="settings__section">
      <legend className="settings__heading">{title}</legend>
      {children}
    </fieldset>
  )
}

export function RuleFields({ texts, onEdit, errorOf }: { texts: RuleTexts; onEdit: (texts: RuleTexts) => void; errorOf: (field: string) => Notice | null }) {
  return (
    <Section title={t.settings.rules}>
      <span className="settings__hint">{t.settings.rulesHint}</span>
      <div className="settings__rules">
        {RULE_KEYS.map((key) => (
          <label key={key} className="settings__field">
            <span className="settings__label">{t.settings.rule[key]}</span>
            <textarea
              className="settings__text"
              rows={2}
              spellCheck={false}
              value={texts[key]}
              placeholder={t.settings.rulePlaceholder[key]}
              aria-invalid={errorOf(`chain.${key}`) !== null}
              onChange={(event) => onEdit({ ...texts, [key]: event.target.value })}
            />
            <FieldNote error={errorOf(`chain.${key}`)} />
          </label>
        ))}
      </div>
    </Section>
  )
}
