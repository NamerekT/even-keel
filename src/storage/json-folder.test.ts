import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JsonFolder } from './json-folder.js'

const parse = (raw: string) => {
  const value = JSON.parse(raw) as { id?: unknown }
  return typeof value.id === 'string' ? { id: value.id } : undefined
}

describe('JsonFolder', () => {
  let dir: string
  let now: number
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-json-folder-'))
    now = 0
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const put = (name: string, text: string) => writeFileSync(join(dir, name), text)
  const ids = (folder: JsonFolder<{ id: string }>) => folder.all().map((each) => each.id).sort()

  it('parses the json files, leaving out other files and broken or foreign ones', () => {
    put('a.json', '{"id":"a"}')
    put('b.json', '{oops')
    put('c.json', '{"other":1}')
    put('d.txt', '{"id":"d"}')
    mkdirSync(join(dir, 'e.json.d'))
    expect(ids(new JsonFolder(dir, parse, 1_000, () => now))).toEqual(['a'])
  })

  it('reads the folder once while the last read is fresh, anew after it and at once after forget', () => {
    put('a.json', '{"id":"a"}')
    const folder = new JsonFolder(dir, parse, 1_000, () => now)
    expect(ids(folder)).toEqual(['a'])
    put('b.json', '{"id":"b"}')
    now = 999
    expect(ids(folder)).toEqual(['a'])
    now = 1_000
    expect(ids(folder)).toEqual(['a', 'b'])
    put('c.json', '{"id":"c"}')
    folder.forget()
    expect(ids(folder)).toEqual(['a', 'b', 'c'])
  })

  it('is empty while the folder does not exist', () => {
    expect(new JsonFolder(join(dir, 'none'), parse, 1_000, () => now).all()).toEqual([])
  })
})
