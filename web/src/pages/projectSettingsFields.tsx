import type { Notice } from '../../../src/notice/notice.js'
import { t } from '../i18n/index.js'
import { Select } from '../ui/Select.js'
import { switchOf } from './projectForm.js'
import { labelOf, onOff, same, type Option } from './projectSettingsDraft.js'
import { edited, inheritedEdit, ownEdited, reverted, type Draft, type Value, type Values } from './settingsDraft.js'
import { ErrorStrip, FieldHead, fieldId, FieldNote, type Inheritance, marksOf, Row, shown, SwitchField } from './settingsParts.js'
import type { SetDraft } from './settingsStore.js'

/** The project settings panel's draft and the field builders its tabs draw their rows with. */
export function panelFields(draft: Draft, setDraft: SetDraft, saved: Values, errorOf: (field: string) => Notice | null) {
  const text = (key: string) => draft.edit[key] as string
  const on = (key: string) => draft.edit[key] as boolean
  const edit = (key: string, value: Value) => setDraft(edited(draft, key, value))
  const editAll = (changes: [string, Value][]) => setDraft(changes.reduce((each, [key, value]) => edited(each, key, value), draft))
  const editInherited = (key: string, value: Value, sharedValue: Value) => setDraft(inheritedEdit(draft, key, value, sharedValue, same))
  const revert = (keys: readonly string[]) => setDraft(reverted(draft, saved, keys))
  const marks = marksOf(draft, saved, same, revert)

  // A key whose '' is "as shared": the field shows the shared value under a chip until an edit makes it the project's own.
  const inheritOf = (key: string, sharedLabel: string, disabled = false): Inheritance => ({ own: text(key) !== '', shared: sharedLabel, disabled, onReset: () => edit(key, '') })
  const notes = (key: string) => <FieldNote error={errorOf(key)} />
  const pick = (key: string, label: string, hint: string, options: Option[], inherit?: { value: string; label: string }) => (
    <Row
      className={marks.box(key)}
      label={label}
      hint={hint}
      htmlFor={fieldId(key)}
      inherit={inherit === undefined ? undefined : inheritOf(key, inherit.label)}
      mark={marks.note(key, (value) => (inherit !== undefined && value === '' ? t.settings.asShared(inherit.label) : labelOf(options)(value)))}
      control={
        <Select
          id={fieldId(key)}
          className="settings__text"
          value={inherit === undefined || text(key) !== '' ? text(key) : inherit.value}
          options={options}
          invalid={errorOf(key) !== null}
          onChange={(value) => (inherit === undefined ? edit(key, value) : editInherited(key, value, inherit.value))}
        />
      }
      error={errorOf(key)}
    />
  )
  const inheritedSwitch = (key: string, label: string, hint: string, sharedValue: boolean, disabled = false) => (
    <SwitchField
      className={marks.box(key)}
      label={label}
      hint={hint}
      checked={switchOf(text(key)) ?? sharedValue}
      disabled={disabled}
      inherit={inheritOf(key, onOff(sharedValue), disabled)}
      mark={marks.note(key, (value) => (value === '' ? t.settings.asShared(onOff(sharedValue)) : onOff(value === 'true')))}
      onChange={(checked) => editInherited(key, String(checked), String(sharedValue))}
    >
      {notes(key)}
    </SwitchField>
  )
  const input = (key: string, label: string, hint: string, placeholder?: string, mono = true) => (
    <Row
      className={marks.box(key)}
      label={label}
      hint={hint}
      htmlFor={fieldId(key)}
      mark={marks.note(key)}
      control={
        <input
          id={fieldId(key)}
          className={mono ? 'settings__text settings__text--mono' : 'settings__text'}
          autoComplete="off"
          spellCheck={false}
          value={text(key)}
          placeholder={placeholder}
          aria-invalid={errorOf(key) !== null}
          onChange={(event) => edit(key, event.target.value)}
        />
      }
      error={errorOf(key)}
    />
  )
  const lines = (key: string, label: string, hint: string, placeholder: string, rows: number, mono = true, disabled = false) => (
    <div className={marks.box(key)}>
      <FieldHead label={label} hint={hint} htmlFor={fieldId(key)} mark={marks.note(key)} />
      <ErrorStrip error={errorOf(key)} wide>
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
      </ErrorStrip>
    </div>
  )

  // Fields kept own by a flag: they show the shared values until an edit turns the flag on with the shared values as the start.
  const ownEdit = (flag: string, sharedValues: Values) => (key: string, value: Value) => setDraft(ownEdited(draft, flag, sharedValues, key, value, same))
  const ownInherit = (flag: string, sharedValues: Values, sharedLabel: string, disabled = false): Inheritance => ({
    own: on(flag),
    shared: sharedLabel,
    disabled,
    onReset: () => setDraft(Object.keys(sharedValues).reduce((each, field) => edited(each, field, saved[field]!), edited(draft, flag, false))),
  })
  // One undo for a flag and its fields: "was: shared" when the field turned own, else what its value was.
  const flagNote = (flag: string, fields: readonly string[], show: (value: Value) => string = shown) =>
    marks.note([flag, ...fields], (value, key) => (key !== flag ? show(value) : value === true ? t.settings.ownChip : t.settings.sharedChip))
  const number = (key: string, value: string, invalid: boolean, onChange: (value: string) => void, extra: { placeholder?: string; disabled?: boolean; label?: string } = {}) => (
    <input
      id={fieldId(key)}
      className="settings__text settings__number"
      inputMode="numeric"
      autoComplete="off"
      aria-label={extra.label}
      value={value}
      placeholder={extra.placeholder}
      disabled={extra.disabled}
      aria-invalid={invalid}
      onChange={(event) => onChange(event.target.value)}
    />
  )

  return {
    draft,
    setDraft,
    saved,
    errorOf,
    text,
    on,
    edit,
    editAll,
    editInherited,
    revert,
    marks,
    inheritOf,
    notes,
    pick,
    inheritedSwitch,
    input,
    lines,
    ownEdit,
    ownInherit,
    flagNote,
    number,
  }
}

export type PanelFields = ReturnType<typeof panelFields>
