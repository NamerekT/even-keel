import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { t } from '../i18n/index.js'
import { tableTexts } from '../i18n/table.js'
import { PlusIcon, TrashIcon } from '../ui/icons.js'
import { Select } from '../ui/Select.js'
import { SuggestField } from '../ui/SuggestField.js'
import { linesText, rowsOf } from './settingsRows.js'
import { addingRow } from './settingsAdding.js'
import { pendingRow, type PendingRow } from './settingsDraft.js'
import { useTableDraft } from './settingsTableDraft.js'

export interface Column {
  title: string
  /** What the empty cell of the adding row asks for. */
  placeholder: string
  /** Offered while typing; any other value may still be typed. */
  suggest?: readonly string[]
  /** A pick from these instead of typing. */
  options?: readonly { value: string; label: string }[]
  /** Enter breaks the line instead of ending the cell. */
  multiline?: boolean
  mono?: boolean
  /** A fixed width, for a short pick. */
  width?: string
}

interface CellProps {
  column: Column
  value: string
  label: string
  /** Values of the first column other rows hold: a pick or a suggestion never repeats them. */
  taken: readonly string[]
  invalid?: boolean
  onChange: (value: string) => void
  onEnter?: () => void
}

function Cell({ column, value, label, taken, invalid = false, onChange, onEnter }: CellProps) {
  const className = column.mono ? 'rows__input rows__input--mono' : 'rows__input'
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || (column.multiline && !event.ctrlKey && !event.metaKey)) return
    // Enter would submit the form, and with it the save.
    event.preventDefault()
    onEnter?.()
  }
  if (column.options !== undefined) {
    return (
      <Select
        className={className}
        label={label}
        value={value}
        invalid={invalid}
        options={column.options.filter((option) => option.value === value || !taken.includes(option.value))}
        onChange={onChange}
      />
    )
  }
  if (column.suggest !== undefined) {
    return (
      <SuggestField
        className={className}
        label={label}
        invalid={invalid}
        mono={column.mono}
        value={value}
        options={column.suggest.filter((each) => !taken.includes(each))}
        placeholder={onEnter === undefined ? undefined : column.placeholder}
        onKeyDown={onKeyDown}
        onChange={onChange}
      />
    )
  }
  return (
    <textarea
      className={className}
      aria-label={label}
      aria-invalid={invalid}
      rows={1}
      spellCheck={false}
      value={value}
      placeholder={onEnter === undefined ? undefined : column.placeholder}
      onKeyDown={onKeyDown}
      onChange={(event) => onChange(column.multiline ? event.target.value : event.target.value.replace(/\s*\n\s*/g, ' '))}
    />
  )
}

/**
 * Rows edited in place: a cell changes as it is typed, a row goes with its bin, the last row adds one once every cell
 * of it is filled. The first column is the key: two rows never share it.
 */
export function RowsTable({
  field,
  encode = JSON.stringify,
  label,
  columns,
  rows,
  empty,
  rowNote,
  onChange,
}: {
  field?: string
  encode?: (rows: readonly (readonly string[])[]) => string
  label: string
  columns: readonly Column[]
  rows: readonly (readonly string[])[]
  empty: string
  rowNote?: (row: readonly string[]) => ReactNode
  onChange: (rows: string[][]) => void
}) {
  const store = useTableDraft()
  const key = field ?? label
  const [local, setLocal] = useState<PendingRow | null>(null)
  const pending = store === null ? local : store.draft.adding?.[key]
  const checked = pending?.checked === true
  const table = useRef<HTMLDivElement>(null)
  const check = () => {
    if (store === null) setLocal((row) => row === null ? null : { ...row, checked: true })
    else store.setDraft((before) => {
      const row = before.adding?.[key]
      return row === undefined ? before : pendingRow(before, key, { ...row, checked: true })
    })
  }
  useEffect(() => {
    const element = table.current!
    element.addEventListener('validate-rows', check)
    return () => element.removeEventListener('validate-rows', check)
  }, [store?.setDraft, key])
  const adding = pending?.cells ?? columns.map(() => '')
  const state = addingRow(columns, rows, adding)
  const fresh = state.cells
  const keys = rows.map((row) => row[0]!.trim())
  const free = (column: Column) => column.options?.find((option) => !keys.includes(option.value))?.value ?? ''
  const full = state.started || columns[0]!.options === undefined || free(columns[0]!) !== ''
  const canAdd = state.valid
  const invalid = rows.some((row, at) => row.some((cell) => cell.trim() === '') || keys.some((key, each) => each !== at && key === row[0]!.trim())) || (state.started && !state.valid)
  const keep = (cells: readonly string[], nextRows = rows) => {
    const next = addingRow(columns, nextRows, cells)
    const value = next.started ? { cells: next.cells, value: encode([...nextRows, next.cells.map((cell) => cell.trim())]), valid: next.valid, checked: !next.valid && checked } : null
    if (store === null) setLocal(value)
    else store.setDraft((before) => pendingRow(before, key, value))
  }
  const update = (nextRows: string[][]) => {
    onChange(nextRows)
    keep(fresh, nextRows)
  }

  const put = (at: number, column: number, value: string) => update(rows.map((row, index) => (index === at ? row.map((cell, each) => (each === column ? value : cell)) : [...row])))
  const add = () => {
    if (!canAdd) return
    onChange([...rows.map((row) => [...row]), fresh.map((value) => value.trim())])
    keep(columns.map(() => ''))
  }

  return (
    <div className="rows" ref={table} data-rows-invalid={invalid}>
      <table className="rows__table" aria-label={label}>
        <colgroup>
          {columns.map((column, at) => (
            <col key={at} style={column.width === undefined ? undefined : { width: column.width }} />
          ))}
          <col className="rows__action-col" />
        </colgroup>
        {columns.length > 1 && (
          <thead>
            <tr>
              {columns.map((column, at) => (
                <th key={at} scope="col">
                  {column.title}
                </th>
              ))}
              <th aria-hidden="true" />
            </tr>
          </thead>
        )}
        <tbody>
          {rows.length === 0 && (
            <tr className="rows__empty">
              <td colSpan={columns.length + 1}>{empty}</td>
            </tr>
          )}
          {rows.map((row, at) => (
            <Fragment key={at}>
              <tr>
                {columns.map((column, each) => (
                  <td key={each} title={each === 0 && keys.some((key, index) => index !== at && key === row[0]!.trim()) ? tableTexts().duplicate : undefined}>
                    <Cell
                      column={column}
                      value={row[each]!}
                      label={`${column.title}, ${t.settings.row(at + 1)}`}
                      taken={each === 0 ? keys.filter((_, index) => index !== at) : []}
                      invalid={row[each]!.trim() === '' || (each === 0 && keys.some((key, index) => index !== at && key.trim() === row[0]!.trim()))}
                      onChange={(value) => put(at, each, value)}
                    />
                  </td>
                ))}
                <td className="rows__action">
                  <button
                    type="button"
                    className="rows__button"
                    title={t.settings.remove(row[0] || t.settings.row(at + 1))}
                    aria-label={t.settings.remove(row[0] || t.settings.row(at + 1))}
                    onClick={() => update(rows.filter((_, index) => index !== at).map((each) => [...each]))}
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
              {rowNote !== undefined && (
                <tr className="rows__note">
                  <td colSpan={columns.length + 1}>{rowNote(row)}</td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
        {full && (
          <tfoot onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) check()
          }}>
            <tr className="rows__new">
              {columns.map((column, at) => (
                <td key={at} title={checked && at === 0 && state.duplicate && state.started ? tableTexts().duplicate : undefined}>
                  <Cell
                    column={column}
                    value={fresh[at]!}
                    label={column.placeholder}
                    taken={at === 0 ? keys : []}
                    invalid={checked && state.invalid[at]}
                    onChange={(value) => keep(columns.map((_, each) => (each === at ? value : fresh[each]!)))}
                    onEnter={add}
                  />
                </td>
              ))}
              <td className="rows__action">
                <button type="button" className="rows__button rows__button--add" title={t.settings.add} aria-label={t.settings.add} disabled={!canAdd} onClick={add}>
                  <PlusIcon />
                </button>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/** A list field kept in the draft as lines, one row a line. */
export function ListTable({
  field,
  label,
  value,
  add,
  empty,
  suggest,
  mono = false,
  onChange,
}: {
  field?: string
  label: string
  value: string
  add: string
  empty: string
  suggest?: readonly string[]
  mono?: boolean
  onChange: (value: string) => void
}) {
  return (
    <RowsTable
      field={field}
      encode={(rows) => linesText(rows.map((row) => row[0]!))}
      label={label}
      columns={[{ title: label, placeholder: add, suggest, mono }]}
      rows={rowsOf(value).map((row) => [row])}
      empty={empty}
      onChange={(rows) => onChange(linesText(rows.map((row) => row[0]!)))}
    />
  )
}
