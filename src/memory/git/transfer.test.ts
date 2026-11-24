import type { PGlite } from '@electric-sql/pglite'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../storage/database.js'
import { stateValue } from '../../storage/service-state.js'
import { memoryFile, MIRROR_MARK, type MemoryFact } from '../record.js'
import { transferPlan, transferRecords, type StoredRecord } from './transfer.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'

const stored = (name: string, file: string | null = null): StoredRecord => ({ name, description: `about ${name}`, type: 'project', body: `${name} body`, file })
const fact = (name: string): MemoryFact => ({ name, description: `hand ${name}`, type: 'project', body: 'hand' })

describe('transferPlan', () => {
  it('writes a record without a file under its name', () => {
    expect([...transferPlan([stored('tone')], new Map(), false).keys()]).toEqual(['tone.md'])
  })

  it('leaves a record whose name a file of the folder carries, under any file name', () => {
    expect(transferPlan([stored('tone', 'tone.md')], new Map([['voice.md', fact('tone')]]), false).size).toBe(0)
  })

  it('leaves a record whose last file holds another record now, and numbers a taken name', () => {
    const files = new Map([['tone.md', fact('other')]])
    expect(transferPlan([stored('tone', 'tone.md')], files, false).size).toBe(0)
    expect([...transferPlan([stored('tone')], files, false).keys()]).toEqual(['tone-2.md'])
  })

  it('leaves a record whose file a person removed from a mirrored folder, and writes it back into an unmarked one', () => {
    expect(transferPlan([stored('tone', 'tone.md')], new Map(), true).size).toBe(0)
    expect([...transferPlan([stored('tone', 'tone.md')], new Map(), false).keys()]).toEqual(['tone.md'])
  })
})

describe('transferRecords', { timeout: 120_000 }, () => {
  let db: PGlite
  let root: string
  let folder: string
  const logs: string[] = []

  beforeAll(async () => {
    db = await openDatabase(undefined)
  })
  afterAll(() => db.close())
  beforeEach(async () => {
    await db.exec(`delete from memory_records; delete from service_state where name = 'memory.transferred'`)
    root = mkdtempSync(join(tmpdir(), 'ek-memory-transfer-'))
    folder = join(root, 'project')
    logs.length = 0
    return () => rmSync(root, { recursive: true, force: true })
  })

  const insert = (name: string, deleted = false, file: string | null = null) =>
    db.query(`insert into memory_records (project_id, name, description, type, body, version, deleted, file, at) values ($1, $2, $3, 'project', $4, 1, $5, $6, 'now')`, [
      PROJECT,
      name,
      `about ${name}`,
      `${name} body`,
      deleted,
      file,
    ])

  it('writes the live records with their index and attributes once, and marks the project', async () => {
    await insert('tone')
    await insert('gone', true)
    expect(await transferRecords(db, PROJECT, folder, (line) => logs.push(line))).toEqual(['tone.md'])
    expect(readdirSync(folder).sort()).toEqual(['.gitattributes', 'MEMORY.md', 'tone.md'])
    expect(readFileSync(join(folder, 'MEMORY.md'), 'utf8')).toBe('- [tone](tone.md) — about tone\n')
    expect(await stateValue(db, 'memory.transferred')).toEqual([PROJECT])
    expect(logs[0]).toContain('1 files written')

    rmSync(join(folder, 'tone.md'))
    expect(await transferRecords(db, PROJECT, folder, () => {})).toEqual([])
    expect(readdirSync(folder)).not.toContain('tone.md')
  })

  it('keeps the hand edit of a folder the mirror kept, and its index lines', async () => {
    mkdirSync(folder)
    writeFileSync(join(folder, MIRROR_MARK), PROJECT)
    writeFileSync(join(folder, 'tone.md'), memoryFile({ ...fact('tone'), body: 'edited by hand' }))
    writeFileSync(join(folder, 'MEMORY.md'), '# Notes\n- [tone](tone.md) — hand tone\n')
    await insert('tone', false, 'tone.md')
    await insert('removed', false, 'removed.md')
    await insert('fresh')
    expect(await transferRecords(db, PROJECT, folder, () => {})).toEqual(['fresh.md'])
    expect(readFileSync(join(folder, 'tone.md'), 'utf8')).toContain('edited by hand')
    expect(readFileSync(join(folder, 'MEMORY.md'), 'utf8')).toBe('# Notes\n- [tone](tone.md) — hand tone\n- [fresh](fresh.md) — about fresh\n')
  })

  it('marks a project without records and leaves its folder unmade', async () => {
    expect(await transferRecords(db, PROJECT, folder, () => {})).toEqual([])
    expect(() => readdirSync(folder)).toThrow()
    expect(await stateValue(db, 'memory.transferred')).toEqual([PROJECT])
  })
})
