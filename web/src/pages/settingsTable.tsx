import { useId, useState, type KeyboardEvent } from 'react'
import { t } from '../i18n/index.js'
import { PlusIcon, TrashIcon } from '../ui/icons.js'
import { Select } from '../ui/Select.js'
import { linesText, rowsOf } from './settingsRows.js'

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
  listId: string
  invalid?: boolean
  onChange: (value: string) => void
  onEnter?: () => void
}

function Cell({ column, value, label, taken, listId, invalid = false, onChange, onEnter }: CellProps) {
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
        options={column.options.filter((option) => option.value === value || !taken.includes(option.value))}
        onChange={onChange}
      />
    )
  }
  if (column.suggest !== undefined) {
    return (
      <input
        className={className}
        aria-label={label}
        aria-invalid={invalid}
        list={listId}
        spellCheck={false}
        value={value}
        placeholder={onEnter === undefined ? undefined : column.placeholder}
        onKeyDown={onKeyDown}
        onChange={(event) => onChange(event.target.value)}
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
  label,
  columns,
  rows,
  empty,
  onChange,
}: {
  label: string
  columns: readonly Column[]
  rows: readonly (readonly string[])[]
  empty: string
  onChange: (rows: string[][]) => void
}) {
  const id = useId()
  const [adding, setAdding] = useState<string[]>(columns.map(() => ''))
  const keys = rows.map((row) => row[0]!)
  const listId = (at: number) => `${id}-list-${at}`
  const free = (column: Column) => column.options?.find((option) => !keys.includes(option.value))?.value ?? ''
  const fresh = columns.map((column, at) => (column.options === undefined ? adding[at]! : adding[at] !== '' && !keys.includes(adding[at]!) ? adding[at]! : free(column)))
  const full = columns[0]!.options === undefined || free(columns[0]!) !== ''
  const canAdd = fresh.every((value) => value.trim() !== '') && !keys.includes(fresh[0]!.trim())

  const put = (at: number, column: number, value: string) => onChange(rows.map((row, index) => (index === at ? row.map((cell, each) => (each === column ? value : cell)) : [...row])))
  const add = () => {
    if (!canAdd) return
    onChange([...rows.map((row) => [...row]), fresh.map((value) => value.trim())])
    setAdding(columns.map(() => ''))
  }

  return (
    <div className="rows">
      {columns.map(
        (column, at) =>
          column.suggest !== undefined && (
            <datalist key={at} id={listId(at)}>
              {column.suggest
                .filter((value) => at !== 0 || !keys.includes(value))
                .map((value) => (
                  <option key={value} value={value} />
                ))}
            </datalist>
          ),
      )}
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
            <tr key={at}>
              {columns.map((column, each) => (
                <td key={each}>
                  <Cell
                    column={column}
                    value={row[each]!}
                    label={`${column.title}, ${t.settings.row(at + 1)}`}
                    taken={each === 0 ? keys.filter((_, index) => index !== at) : []}
                    listId={listId(each)}
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
                  onClick={() => onChange(rows.filter((_, index) => index !== at).map((each) => [...each]))}
                >
                  <TrashIcon />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        {full && (
          <tfoot>
            <tr className="rows__new">
              {columns.map((column, at) => (
                <td key={at}>
                  <Cell
                    column={column}
                    value={fresh[at]!}
                    label={column.placeholder}
                    taken={at === 0 ? keys : []}
                    listId={listId(at)}
                    onChange={(value) => setAdding(columns.map((_, each) => (each === at ? value : fresh[each]!)))}
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
  label,
  value,
  add,
  empty,
  suggest,
  mono = false,
  onChange,
}: {
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
      label={label}
      columns={[{ title: label, placeholder: add, suggest, mono }]}
      rows={rowsOf(value).map((row) => [row])}
      empty={empty}
      onChange={(rows) => onChange(linesText(rows.map((row) => row[0]!)))}
    />
  )
}
