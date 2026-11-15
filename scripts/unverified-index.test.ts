import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { entries as readEntries, indexRows } from './unverified-entries.js'

const docs = new URL('../docs/', import.meta.url)
const read = (path: string): string => readFileSync(new URL(path, docs), 'utf8').replace(/\r\n/g, '\n')

const entries = () => readEntries(fileURLToPath(docs))

const order = (id: string): [number, string, number] => {
  const parts = /^(\d+)([a-z]*)(\d*)$/.exec(id)!
  return [Number(parts[1]), parts[2]!, parts[3] === '' ? -1 : Number(parts[3])]
}
const compare = (a: string, b: string): number => {
  const [an, al, ad] = order(a)
  const [bn, bl, bd] = order(b)
  return an - bn || (al < bl ? -1 : al > bl ? 1 : 0) || ad - bd
}

describe('docs/unverified.md index', () => {
  const rows = indexRows(read('unverified.md'))

  it('puts every row into one of the three sections', () => {
    const allowed = ['Check first', 'Then', 'Waiting for the event / not checked by choice']
    expect(rows.filter((row) => !allowed.includes(row.section)).map((row) => row.id)).toEqual([])
    expect(rows.length).toBeGreaterThan(100)
  })

  it('uses unique IDs of the permanent form', () => {
    const ids = rows.map((row) => row.id)
    expect(ids.filter((id) => !/^\d+[a-z]*\d*$/.test(id))).toEqual([])
    expect(ids.filter((id, at) => ids.indexOf(id) !== at)).toEqual([])
  })

  it('links every row to an existing entry heading', () => {
    const known = new Set(entries().map((entry) => `${entry.file}#${entry.anchor}`))
    expect(rows.filter((row) => !known.has(`${row.file}#${row.anchor}`)).map((row) => row.id)).toEqual([])
  })

  it('has exactly one row for every entry heading', () => {
    const count = new Map<string, number>()
    for (const row of rows) count.set(`${row.file}#${row.anchor}`, (count.get(`${row.file}#${row.anchor}`) ?? 0) + 1)
    const wrong = entries()
      .filter((entry) => count.get(`${entry.file}#${entry.anchor}`) !== 1)
      .map((entry) => `${entry.file}: ${entry.heading}`)
    expect(wrong).toEqual([])
  })

  it('keeps every section ordered by ID', () => {
    for (const section of new Set(rows.map((row) => row.section))) {
      const ids = rows.filter((row) => row.section === section).map((row) => row.id)
      expect(ids, section).toEqual([...ids].sort(compare))
    }
  })

  it('names a check task or a dash in the Task cell', () => {
    expect(rows.filter((row) => !/^(—|(BTN|EKR)-\d+)$/.test(row.task)).map((row) => row.id)).toEqual([])
  })
})
