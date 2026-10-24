import { Fragment, useId, type CSSProperties, type ReactNode } from 'react'
import type { ChainRules } from '../../../src/chain/rules.js'
import type { Notice } from '../../../src/notice/notice.js'
import type { CheckpointShares, ConfigView } from '../../../src/state.js'
import { sayAtField, t } from '../i18n/index.js'
import { CheckIcon, InheritIcon, QuestionIcon, UndoIcon } from '../ui/icons.js'
import { useTip, type TipAlign } from '../ui/useTip.js'
import type { Draft, Same, Value, Values } from './settingsDraft.js'
import { fieldOf } from './settingsField.js'
import { providerName } from './settingsRun.js'

export const RULE_KEYS = ['active', 'terminal', 'requiredLabels', 'excludedLabels', 'requiredMilestones', 'excludedMilestones'] as const
export type RuleKey = (typeof RULE_KEYS)[number]
export type RuleTexts = Record<RuleKey, string>

export const linesOf = (text: string) => text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
export const rulesText = (rules: ChainRules): RuleTexts => ({
  active: (rules.active ?? []).join('\n'),
  terminal: (rules.terminal ?? []).join('\n'),
  requiredLabels: rules.requiredLabels.join('\n'),
  excludedLabels: rules.excludedLabels.join('\n'),
  requiredMilestones: rules.requiredMilestones.join('\n'),
  excludedMilestones: rules.excludedMilestones.join('\n'),
})
/** An empty status list goes by the categories of the statuses, as the service stores it. */
export const rulesOf = (texts: Readonly<Record<RuleKey, Value>>): ChainRules => {
  const lines = (key: RuleKey) => linesOf(texts[key] as string)
  const statuses = (key: RuleKey) => (lines(key).length === 0 ? null : lines(key))
  return {
    active: statuses('active'),
    terminal: statuses('terminal'),
    requiredLabels: lines('requiredLabels'),
    excludedLabels: lines('excludedLabels'),
    requiredMilestones: lines('requiredMilestones'),
    excludedMilestones: lines('excludedMilestones'),
  }
}

/** A whole number from `min` on; `undefined` — not one. */
export const wholeOf = (text: string, min: number): number | undefined => {
  const value = Number(text)
  return text.trim() !== '' && Number.isInteger(value) && value >= min ? value : undefined
}

/** The longest wait for CI: empty — as long as it takes; `undefined` — not a whole number of minutes. */
export const minutesOf = (text: string): number | null | undefined => (text.trim() === '' ? null : wholeOf(text, 0))

/** The draft keys of the checkpoint shares, also the keys of their labels in `t.shared`. */
export const SHARE_KEYS = ['shareFirst', 'shareLate', 'shareHard'] as const
/** A share of the context window, a whole percent; `undefined` — not one. The service judges the range and the order. */
export const shareOf = (text: string) => wholeOf(text, 1)
export const sharesText = (shares: CheckpointShares) => ({ shareFirst: String(shares.first), shareLate: String(shares.late), shareHard: String(shares.hard) })
export const sharesOf = (values: Values): CheckpointShares | undefined => {
  const [first, late, hard] = SHARE_KEYS.map((key) => shareOf(values[key] as string))
  return first === undefined || late === undefined || hard === undefined ? undefined : { first, late, hard }
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

/**
 * A question mark after a setting's name: pressed, it tells what the setting does; pressed again, Escape or a press elsewhere closes it.
 * Pointing and focus open nothing — focus would open it just before the click of the same press closed it.
 * Out of the Tab order: Tab goes from field to field in a form, not through every question mark.
 */
export function HelpTip({ text, align }: { text: string; align?: TipAlign }) {
  const { shown, anchor, tip, toggle, close } = useTip<HTMLButtonElement, HTMLSpanElement>(true, align)
  const id = useId()
  return (
    <button
      ref={anchor}
      type="button"
      className="help"
      tabIndex={-1}
      aria-label={t.settings.help}
      aria-describedby={id}
      aria-expanded={shown}
      onClick={toggle}
      onKeyDown={(event) => event.key === 'Escape' && close()}
    >
      <QuestionIcon />
      <span id={id} hidden>
        {text}
      </span>
      {shown && (
        <span ref={tip} popover="manual" className="help__tip" role="tooltip">
          {text}
        </span>
      )}
    </button>
  )
}

/** Whether a project's field holds the shared value or its own, and how the own one goes back to the shared. */
export interface Inheritance {
  own: boolean
  /** The shared value as the field shows it. */
  shared: string
  onReset: () => void
  disabled?: boolean
}

/**
 * The one mark of inheritance (BTN-337): a chip "shared" while the field shows the shared value, "own" once the
 * project has its own, a press putting the shared one back. An edit of the field is what makes it own. Not the
 * "was … ↺" of an unsaved change: that one undoes the draft, this one changes it.
 */
export function Inherit({ own, shared, onReset, disabled = false }: Inheritance) {
  return own ? (
    <button
      type="button"
      className="inherit inherit--own"
      title={t.settings.toShared(shared)}
      aria-label={t.settings.toShared(shared)}
      disabled={disabled}
      onClick={onReset}
    >
      <InheritIcon />
      {t.settings.ownChip}
    </button>
  ) : (
    <span className="inherit" title={t.settings.sharedTip}>
      {t.settings.sharedChip}
    </span>
  )
}

/** A setting's name and its help. `htmlFor` ties the name to its control. */
/** `soon` — a badge for a field that is fixed for now: the version that will let it change. */
export function FieldHead({ label, hint, htmlFor, soon, inherit }: { label: string; hint?: string; htmlFor?: string; soon?: string; inherit?: Inheritance }) {
  return (
    <span className="settings__head-row">
      {htmlFor === undefined ? (
        <span className="settings__label">{label}</span>
      ) : (
        <label className="settings__label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {hint !== undefined && <HelpTip text={hint} />}
      {soon !== undefined && <span className="settings__soon">{soon}</span>}
      {inherit !== undefined && <Inherit {...inherit} />}
    </span>
  )
}

/**
 * A short setting on one line: its name at the left, its control at the right edge, one width for every control;
 * `children` go under both — the marks of a change and the error.
 */
export function Row({
  className,
  label,
  hint,
  htmlFor,
  inherit,
  control,
  children,
}: {
  className: string
  label: string
  hint?: string
  htmlFor?: string
  inherit?: Inheritance
  control: ReactNode
  children?: ReactNode
}) {
  return (
    <div className={`${className} settings__line`}>
      <div className="settings__line-main">
        <FieldHead label={label} hint={hint} htmlFor={htmlFor} inherit={inherit} />
        <div className="settings__control">{control}</div>
      </div>
      {children}
    </div>
  )
}

/** On or off: a switch, never a pick of two. */
export function Switch({ id, checked, disabled = false, label, onChange }: { id?: string; checked: boolean; disabled?: boolean; label?: string; onChange: (checked: boolean) => void }) {
  return (
    <button id={id} type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="switch__knob" />
    </button>
  )
}

/** An on/off setting as a row with a switch at its right. */
export function SwitchField({
  className,
  label,
  hint,
  checked,
  disabled = false,
  inherit,
  onChange,
  children,
}: {
  className: string
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  inherit?: Inheritance
  onChange: (checked: boolean) => void
  children?: ReactNode
}) {
  const id = useId()
  return (
    <Row className={className} label={label} hint={hint} htmlFor={id} inherit={inherit} control={<Switch id={id} checked={checked} disabled={disabled} onChange={onChange} />}>
      {children}
    </Row>
  )
}

/** The id of a field's control, for its name to point at. */
export const fieldId = (key: string) => `setting-${key.replace(/\W/g, '-')}`

export function FieldNote({ error }: { error: Notice | null }) {
  return error === null ? null : (
    <span className="settings__error" role="alert">
      {sayAtField(error)}
    </span>
  )
}

/**
 * The settings kept per provider as a table: a row per provider, a column per setting, so one setting lines up across providers.
 * A cell holds its control without a visible name — the column heads name them; `cell` gives it an accessible one.
 * Too narrow for the columns (a phone), every cell takes its column's name over its control instead.
 */
export function ProviderGrid({
  columns,
  providers,
  cell,
}: {
  columns: readonly { key: string; label: string; hint: string }[]
  providers: readonly string[]
  /** `null` — the provider has no such setting. */
  cell: (column: string, provider: string) => ReactNode | null
}) {
  return (
    <div className="provider-grid">
      <div className="provider-grid__table" style={{ '--columns': columns.length } as CSSProperties}>
        <span className="provider-grid__corner" />
        {columns.map((column) => (
          <span key={column.key} className="settings__head-row provider-grid__head">
            <span className="settings__label">{column.label}</span>
            <HelpTip text={column.hint} />
          </span>
        ))}
        {providers.map((provider) => (
          <Fragment key={provider}>
            <span className="provider-grid__name">{providerName(provider)}</span>
            {columns.map((column) => {
              const control = cell(column.key, provider)
              return (
                <div key={column.key} className={control === null ? 'provider-grid__cell provider-grid__cell--none' : 'provider-grid__cell'}>
                  <FieldHead label={column.label} hint={column.hint} />
                  {control ?? <span className="provider-grid__none">—</span>}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/**
 * A card of related fields with its title; `mark` — before the title (a wizard step's dot); `aside` — at the title's
 * right; `danger` — what cannot be undone, framed red.
 */
export function Section({
  title,
  hint,
  mark,
  aside,
  danger = false,
  className,
  children,
}: {
  title: string
  hint?: string
  mark?: ReactNode
  aside?: ReactNode
  danger?: boolean
  className?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section className={['settings__section', danger && 'settings__section--danger', className].filter(Boolean).join(' ')} aria-labelledby={id}>
      <div className="settings__heading">
        {mark}
        <h3 id={id} className="settings__heading-title">
          {title}
        </h3>
        {hint !== undefined && <HelpTip text={hint} />}
        {aside !== undefined && <span className="settings__heading-aside">{aside}</span>}
      </div>
      {children}
    </section>
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
  label = t.settings.groupsLabel,
}: {
  groups: readonly { id: T; title: ReactNode }[]
  open: T
  dirty: (id: T) => boolean
  onOpen: (id: T) => void
  label?: string
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
      aria-label={label}
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

/**
 * Stuck to the bottom of the form while the open group has changes: put it back, or save it. Hidden, it still holds
 * its place, so its showing up neither moves the form nor covers its last field.
 */
export function SaveBar({ shown, canSave, onRevert }: { shown: boolean; canSave: boolean; onRevert: () => void }) {
  return (
    <div className={shown ? 'settings__bar' : 'settings__bar settings__bar--idle'} aria-hidden={!shown}>
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
