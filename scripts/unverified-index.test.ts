import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const docs = new URL('../docs/', import.meta.url)
const read = (path: string): string => readFileSync(new URL(path, docs), 'utf8').replace(/\r\n/g, '\n')

interface Row {
  id: string
  section: string
  file: string
  anchor: string
  task: string
}

const indexRows = (): Row[] => {
  const rows: Row[] = []
  let section = ''
  let inIndex = false
  for (const line of read('unverified.md').split('\n')) {
    if (line.startsWith('## ')) inIndex = line === '## What to check first'
    if (!inIndex) continue
    if (line.startsWith('### ')) section = line.slice(4)
    const cells = line.match(/^\| (\S+) \| \[.*?\]\(unverified\/([\w-]+\.md)#(.+?)\) \|.* \| (\S+) \|$/)
    if (cells) rows.push({ id: cells[1]!, section, file: cells[2]!, anchor: cells[3]!, task: cells[4]! })
  }
  return rows
}

/** GitHub's slug of a heading: lower case, punctuation but `_` and `-` dropped, spaces to hyphens. */
const slug = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')

/** The `##` headings of an area file are all entries; fenced lines are skipped. */
const entries = (): { file: string; anchor: string; heading: string }[] => {
  const found: { file: string; anchor: string; heading: string }[] = []
  for (const file of readdirSync(new URL('unverified/', docs)).filter((name) => name.endsWith('.md'))) {
    let fenced = false
    for (const line of read(`unverified/${file}`).split('\n')) {
      if (line.startsWith('```')) fenced = !fenced
      if (!fenced && line.startsWith('## ')) found.push({ file, anchor: slug(line.slice(3)), heading: line.slice(3) })
    }
  }
  return found
}

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
  const rows = indexRows()

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
