import type { ReactNode } from 'react'
import type { ChainRules } from '../../../src/chain/rules.js'
import type { Notice } from '../../../src/notice/notice.js'
import type { ConfigView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { CheckIcon, UndoIcon } from '../ui/icons.js'
import type { Draft, Same, Value, Values } from './settingsDraft.js'
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
export const rulesOf = (texts: Readonly<Record<RuleKey, Value>>): ChainRules => {
  const lines = (key: RuleKey) => linesOf(texts[key] as string)
  const statuses = (key: RuleKey) => (lines(key).length === 0 ? null : lines(key))
  return { active: statuses('active'), terminal: statuses('terminal'), requiredLabels: lines('requiredLabels'), excludedLabels: lines('excludedLabels') }
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

/** The rules are fields of the draft under their own names. */
export function RuleFields({
  text,
  onEdit,
  errorOf,
  marks,
}: {
  text: (key: RuleKey) => string
  onEdit: (key: RuleKey, text: string) => void
  errorOf: (field: string) => Notice | null
  marks: Marks
}) {
  return (
    <Section title={t.settings.rules}>
      <span className="settings__hint">{t.settings.rulesHint}</span>
      <div className="settings__rules">
        {RULE_KEYS.map((key) => (
          <label key={key} className={marks.box(key)}>
            <span className="settings__label">{t.settings.rule[key]}</span>
            <textarea
              className="settings__text"
              rows={2}
              spellCheck={false}
              value={text(key)}
              placeholder={t.settings.rulePlaceholder[key]}
              aria-invalid={errorOf(`chain.${key}`) !== null}
              onChange={(event) => onEdit(key, event.target.value)}
            />
            {marks.note(key)}
            <FieldNote error={errorOf(`chain.${key}`)} />
          </label>
        ))}
      </div>
    </Section>
  )
}

/** Values compare as the service stores them: text trimmed, the fields of `lists` line by line, picks in any order. */
export const sameBy =
  (lists: readonly string[]): Same =>
  (key, a, b) => {
    const canon = (value: Value) => (typeof value === 'string' ? (lists.includes(key) ? linesOf(value) : value.trim()) : Array.isArray(value) ? [...value].sort() : value)
    return JSON.stringify(canon(a)) === JSON.stringify(canon(b))
  }

/** A value in one short line, for the marks under a changed field. */
export function shown(value: Value): string {
  if (typeof value === 'boolean') return value ? t.settings.on : t.settings.off
  const parts = typeof value === 'string' ? linesOf(value) : [...value]
  return parts.length === 0 ? t.settings.empty : parts.join(' · ')
}

export interface Marks {
  /** The class of a field's box, with a stripe when a value of `keys` is changed. */
  box(keys: string | readonly string[], name?: string): string
  /** Under a changed field: what it was, what the file holds now if that changed too, and a button putting it back. */
  note(key: string, show?: (value: Value) => string): ReactNode
}

export function marksOf(draft: Draft, saved: Values, same: Same, revert: (keys: string[]) => void): Marks {
  const changed = (key: string) => !same(key, draft.edit[key]!, draft.base[key]!)
  return {
    box: (keys, name = 'settings__field') => ([keys].flat().some(changed) ? `${name} settings__field--changed` : name),
    note: (key, show = shown) => {
      if (!changed(key)) return null
      const was = show(draft.base[key]!)
      const now = same(key, saved[key]!, draft.base[key]!) ? null : show(saved[key]!)
      return (
        <span className="settings__mark">
          <span className="settings__was" title={was}>
            {t.settings.was} <span className="settings__value">{was}</span>
          </span>
          <button type="button" className="settings__undo" title={t.settings.revertField} aria-label={t.settings.revertField} onClick={() => revert([key])}>
            <UndoIcon />
          </button>
          {now !== null && (
            <span className="settings__now" title={now}>
              {t.settings.inFile} <span className="settings__value">{now}</span>
            </span>
          )}
        </span>
      )
    },
  }
}

export function UnsavedDot() {
  return <span className="settings-dot" role="img" aria-label={t.settings.unsaved} title={t.settings.unsaved} />
}

/** The groups of a settings form, switched like the tabs over the side column. */
export function GroupTabs<T extends string>({
  groups,
  open,
  dirty,
  onOpen,
}: {
  groups: readonly { id: T; title: string }[]
  open: T
  dirty: (id: T) => boolean
  onOpen: (id: T) => void
}) {
  const step = (by: number) => {
    const at = groups.findIndex((group) => group.id === open)
    const next = groups[(at + by + groups.length) % groups.length]!.id
    onOpen(next)
    document.getElementById(`settings-tab-${next}`)?.focus()
  }
  return (
    <div
      className="settings-tabs"
      role="tablist"
      aria-label={t.settings.groupsLabel}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault()
          step(event.key === 'ArrowRight' ? 1 : -1)
        }
      }}
    >
      {groups.map(({ id, title }) => (
        <button
          key={id}
          id={`settings-tab-${id}`}
          type="button"
          role="tab"
          className="settings-tab"
          aria-selected={id === open}
          tabIndex={id === open ? 0 : -1}
          onClick={() => onOpen(id)}
        >
          {title}
          {dirty(id) && <UnsavedDot />}
        </button>
      ))}
    </div>
  )
}

/** Stuck to the bottom of the form while the open group has changes: put it back, or save it. */
export function SaveBar({ canSave, onRevert }: { canSave: boolean; onRevert: () => void }) {
  return (
    <div className="settings__bar">
      <span className="settings__bar-text">{t.settings.unsavedGroup}</span>
      <button type="button" className="settings__icon" title={t.settings.revert} aria-label={t.settings.revert} onClick={onRevert}>
        <UndoIcon />
      </button>
      <button type="submit" className="settings__icon settings__icon--save" title={t.settings.save} aria-label={t.settings.save} disabled={!canSave}>
        <CheckIcon />
      </button>
    </div>
  )
}
