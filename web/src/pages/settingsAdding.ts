interface AddingColumn {
  options?: readonly { value: string }[]
}

/** A select's automatic free choice does not start a row. Keys compare after trimming. */
export function addingRow(columns: readonly AddingColumn[], rows: readonly (readonly string[])[], typed: readonly string[]) {
  const keys = rows.map((row) => row[0]!.trim())
  const cells = columns.map((column, at) => column.options === undefined ? typed[at] ?? '' :
    typed[at] && !keys.includes(typed[at]!.trim()) ? typed[at]! : column.options.find((option) => !keys.includes(option.value))?.value ?? '')
  const started = cells.some((value, at) => columns[at]!.options === undefined && value.trim() !== '')
  const duplicate = keys.includes(cells[0]!.trim())
  const invalid = cells.map((value, at) => started && (value.trim() === '' || (at === 0 && duplicate)))
  return { cells, started, duplicate, invalid, valid: started && !invalid.some(Boolean) }
}
