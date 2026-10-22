import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseConfig } from '../config.js'
import { noticeOf } from '../notice/notice.js'
import { memoryDatabase } from '../storage/memory.js'
import { stateValue } from '../storage/service-state.js'
import { IMPORTED_SUFFIX } from '../storage/state-files.js'
import { fileOf } from './file.js'
import { FULL } from './full.fixture.js'
import { configOfFile, exportConfig, importConfig, prepareSettings } from './import.js'
import { mirrorDefinitions, putSettings, readSettings, settingsText } from './store.js'

const abc = { id: 'id-abc', key: 'ABC', repo: 'C:\\abc' }

describe('the settings in the database', { timeout: 30_000 }, () => {
  let db: PGlite
  let dir: string
  let file: string
  let logs: string[]

  beforeEach(async () => {
    db = await memoryDatabase()
    dir = mkdtempSync(join(tmpdir(), 'even-keel-settings-'))
    file = join(dir, 'even-keel.config.json')
    logs = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const write = (value: unknown) => writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
  const prepare = () => prepareSettings({ db, file, log: (line) => logs.push(line) })
  const config = async () => parseConfig(fileOf(await readSettings(db)))

  it('imports the config file once at the first start and keeps it renamed', async () => {
    write({ parallel: 2, updates: { notify: false, dismissed: '0.2.0' }, projects: [abc] })
    await prepare()
    expect((await config()).parallel).toBe(2)
    expect((await config()).updates).toEqual({ check: true, notify: false })
    expect((await config()).projects).toEqual({ 'id-abc': 'C:\\abc' })
    expect(await stateValue(db, 'updates.dismissed')).toBe('0.2.0')
    expect(existsSync(file)).toBe(false)
    expect(JSON.parse(readFileSync(`${file}${IMPORTED_SUFFIX}`, 'utf8')).parallel).toBe(2)
    expect(logs).toEqual([`config: moved ${file} into the database: 1 projects, 2 settings; the file is kept as ${file}${IMPORTED_SUFFIX}`])

    write({ parallel: 5, projects: [] })
    await prepare()
    expect((await config()).parallel).toBe(2)
    expect(existsSync(file)).toBe(true)
    expect(logs[1]).toMatch(/is not read, the settings are in the database/)
  })

  it('starts empty without a file, and does not read one that comes later', async () => {
    await prepare()
    expect((await config()).projects).toEqual({})
    write({ projects: [abc] })
    await prepare()
    expect((await config()).projects).toEqual({})
  })

  it('keeps the chain switches the database had unless the file sets them', async () => {
    await mirrorDefinitions(db)
    await putSettings(db, [{ key: 'unattended', project: null, qualifier: '', value: true }], 'import')
    await putSettings(db, [{ key: 'trimTools', project: null, qualifier: '', value: false }], 'import')
    write({ trimTools: true, projects: [abc] })
    await prepare()
    expect(await config()).toMatchObject({ unattended: true, trimTools: true })
  })

  it('stops at a file that does not parse, writes nothing and leaves the file', async () => {
    write({ projects: [{ key: 'ABC' }] })
    const code = await prepare().then(
      () => undefined,
      (error: unknown) => noticeOf(error).code,
    )
    expect(code).toBe('config.repoEmpty')
    expect(existsSync(file)).toBe(true)
    expect(await stateValue(db, 'config.imported')).toBeUndefined()
    expect((await readSettings(db)).records).toEqual([])
  })

  it('gives config-export a file config-import reads back into the same rows', async () => {
    await prepare()
    await importConfig(db, FULL)
    const before = await readSettings(db)
    const exported = await exportConfig(db)

    const other = await memoryDatabase()
    await prepareSettings({ db: other, file, log: () => {} })
    await importConfig(other, JSON.parse(exported))
    expect(settingsText(await readSettings(other))).toBe(settingsText(before))
    expect(parseConfig(JSON.parse(exported))).toEqual(parseConfig(FULL))
  })

  it('puts the file whole in place of the stored settings', async () => {
    await prepare()
    await importConfig(db, { parallel: 3, unattended: true, projects: [abc, { id: 'id-xyz', key: 'XYZ', repo: 'C:\\xyz', prompt: 'Hi.' }] })
    await importConfig(db, { projects: [abc] })
    expect(await config()).toMatchObject({ parallel: 1, unattended: false, projects: { 'id-abc': 'C:\\abc' } })
    expect((await db.query('select * from setting_values')).rows).toEqual([])
  })

  it('brings a file of an older schema to the current one and gives its projects ids', () => {
    const { contents } = configOfFile({ model: 'opus', projects: { ABC: 'C:\\abc' } })
    expect(contents.records).toEqual([{ id: expect.stringMatching(/^[0-9a-f-]{36}$/), key: 'ABC', name: null, repo: 'C:\\abc', branch: 'main', trackerProjects: {} }])
    expect(contents.rows).toEqual([{ key: 'models', project: null, qualifier: 'claude', value: 'opus' }])
  })
})
