import { describe, expect, it } from 'vitest'
import { changed, edited, pendingRow, rebase, reverted, sent, settled } from './settingsDraft.js'
import { addingRow } from './settingsAdding.js'
import { invalidPending } from './settingsTableDraft.js'

const same = (_key: string, a: unknown, b: unknown) => a === b
const saved = { rows: '[]', other: '' }
const pending = { cells: ['new', 'text'], value: '[["new","text"]]', valid: true }

describe('a table row in the settings draft', () => {
  it('counts incomplete input as a change and sends complete input without Add', () => {
    const draft = pendingRow(rebase(undefined, saved, same), 'rows', pending)
    expect(changed(draft, ['rows'], same)).toEqual(['rows'])
    expect(sent(draft, ['rows']).form.rows).toBe(pending.value)
    expect(sent(draft, ['other']).form.rows).toBe('[]')
    expect(rebase(draft, saved, same).adding?.rows).toEqual(pending)
  })

  it('keeps a conflicting field and its pending row, then accepts the saved row once', () => {
    const draft = pendingRow(rebase(undefined, saved, same), 'rows', pending)
    const conflict = rebase(draft, { ...saved, rows: '[["remote","text"]]' }, same)
    expect(conflict.base.rows).toBe('[]')
    expect(conflict.edit.rows).toBe('[]')
    expect(conflict.adding?.rows).toEqual(pending)
    const accepted = settled(draft, { ...saved, rows: pending.value }, same)!
    expect(accepted.adding?.rows).toBeUndefined()
    expect(changed(accepted, ['rows'], same)).toEqual([])
    expect(sent(accepted, ['rows']).form.rows).toBe(pending.value)
  })

  it('reverts a row with its field and leaves the other fields alone', () => {
    const draft = edited(pendingRow(rebase(undefined, saved, same), 'rows', pending), 'other', 'kept')
    const back = reverted(draft, saved, ['rows'])
    expect(back.adding?.rows).toBeUndefined()
    expect(back.edit.other).toBe('kept')
  })

  it('keeps incomplete input and its validation after a rejected save or external changes', () => {
    const row = { cells: ['key', ''], value: '[["key",""]]', valid: false, checked: true }
    const draft = pendingRow(rebase(undefined, saved, same), 'rows', row)
    expect(settled(draft, saved, same)).toBeUndefined()
    const next = rebase(draft, { ...saved, other: 'external' }, same)
    expect(next.adding?.rows).toEqual(row)
    expect(next.edit.other).toBe('external')
    expect(invalidPending(next, ['rows'])).toEqual(['rows'])
    expect(invalidPending(next, ['other'])).toEqual([])
    expect(reverted(next, saved, ['rows']).adding).toBeUndefined()
  })
})

describe('adding row validation', () => {
  const columns = [{}, {}]
  it('ignores whitespace and automatic selects until a text cell starts the row', () => {
    expect(addingRow(columns, [], ['  ', '']).started).toBe(false)
    expect(addingRow([{ options: [{ value: 'a' }] }, {}], [], ['', '']).started).toBe(false)
    expect(addingRow([{ options: [{ value: 'a' }] }, {}], [], ['', 'text']).cells).toEqual(['a', 'text'])
  })
  it('marks missing cells and trimmed duplicate keys', () => {
    expect(addingRow(columns, [], ['key', ' ']).invalid).toEqual([false, true])
    expect(addingRow(columns, [['key ', 'value']], [' key', 'text']).invalid).toEqual([true, false])
    expect(addingRow(columns, [], ['key', 'value']).valid).toBe(true)
  })
})
