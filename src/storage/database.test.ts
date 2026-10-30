import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadKeyOrganizations } from '../account/organizations.js'
import { loadChainState } from '../chain/store.js'
import { parseConfig } from '../config.js'
import { readProfiles } from '../profiles/store.js'
import { fileOf } from '../settings/file.js'
import { readSettings } from '../settings/store.js'
import { ABC, XYZ, SECOND_ABC, FEED, fixture, readsWhole } from './database.fixture.js'
import { databaseDirOf, dataDirOf } from './owner.js'
import { prepareDatabase } from './state-files.js'

describe('frozen samples migrate to the current database', { timeout: 120_000 }, () => {
  let stateDir: string
  let logs: string[]
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'even-keel-db-sample-'))
    logs = []
  })
  afterEach(() => rmSync(stateDir, { recursive: true, force: true }))

  const prepare = () => prepareDatabase({ stateDir, log: (line) => logs.push(line) })

  it('of version 8 is brought to the current schema and read whole, the pull requests with it', async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(8))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      const chain = await loadChainState(opened.db)
      expect(chain.reviews).toEqual({ [ABC]: [expect.objectContaining({ task: 'ABC-3', number: 12, seen: ['review:41'], feedback: 'Rename it.' })] })
      const colors = (await readSettings(opened.db)).rows.filter((row) => row.key === 'color')
      expect(colors).toEqual([
        { key: 'color', project: ABC, qualifier: '', value: 1 },
        { key: 'color', project: XYZ, qualifier: '', value: 2 },
      ])
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  it('of version 9 is brought to the current schema and read whole, the colors with it', async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(9))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      expect(parseConfig(fileOf(await readSettings(opened.db))).colors).toEqual({ [ABC]: 3, [XYZ]: 2 })
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  it('of version 10 is brought to the current schema and read whole, the shelved tasks with it', async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(10))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      const chain = await loadChainState(opened.db)
      expect(chain.shelved).toEqual({ [ABC]: [{ task: 'ABC-1', sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', at: '2026-10-19T09:00:00.000Z' }] })
      await opened.db.query(`insert into projects (id, key, repo, branch, position) values ('${SECOND_ABC}', 'ABC', 'C:\\repos\\example-release', 'release/v1', 2)`)
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  it('of version 11 is read whole, two projects of one key with it (BTN-271)', async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(11))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db)
      expect(parseConfig(fileOf(await readSettings(opened.db))).keys).toEqual({ [ABC]: 'ABC', [XYZ]: 'XYZ', [SECOND_ABC]: 'ABC' })
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  it("of version 12 is read with the profiles' rules and the feed's profile (BTN-66)", async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(12))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db, 12)
      const profiles = await readProfiles(opened.db)
      expect(profiles.profiles.map((profile) => profile.rules)).toEqual([{ terminal: ['Done', 'Canceled', 'Shipped'] }, undefined, { excludedLabels: ['wontfix'] }])
      expect(profiles.feeds).toEqual({ [FEED]: '55555555-5555-4555-8555-555555555555' })
      const config = parseConfig(fileOf(await readSettings(opened.db)))
      expect(config.feeds).toEqual({ [ABC]: [{ id: FEED, tracker: 'github', key: 'ABCGH', place: 'octo-org/ideas' }] })
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  it('of version 13 is brought to the current schema and read whole', async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(13))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db, 13)
      expect(parseConfig(fileOf(await readSettings(opened.db))).trackers).toEqual({ [ABC]: 'huly', [XYZ]: 'github', [SECOND_ABC]: 'huly' })
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  it("of version 14 is read with the API keys' organizations (BTN-418)", async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(14))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db, 14)
      expect(await loadKeyOrganizations(opened.db)).toEqual(new Map([['codex-api', 'org-openai-example'], ['work-api', 'org-anthropic-example']]))
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  it("of version 15 keeps a profile's MCP OAuth grant, which reading drops for GitHub (BTN-475, BTN-604)", async () => {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(15))
    await frozen.close()
    const opened = await prepare()
    try {
      await readsWhole(opened.db, 15)
      const rows = await opened.db.query<{ kind: string; mcp_oauth: string }>('select kind, mcp_oauth from tracker_profiles order by position')
      expect(rows.rows.map((row) => (row.mcp_oauth === 'null' ? null : row.kind))).toEqual([null, 'github', null])
      const profiles = (await readProfiles(opened.db)).profiles
      expect(profiles.map((each) => each.mcpOAuth?.accessToken ?? null)).toEqual([null, null, null])
    } finally {
      await opened.close()
    }
    expect(logs).toEqual([])
  })

  /** Version 12 brought to the current schema, `more` run on it first; the tracker rows by project, `null` the shared one. */
  async function trackersOfV12(more = '') {
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    mkdirSync(dataDir, { recursive: true })
    const frozen = await PGlite.create({ dataDir })
    await frozen.exec(fixture(12) + more)
    await frozen.close()
    const opened = await prepare()
    try {
      const rows = await opened.db.query<{ project_id: string | null; value: string }>("select project_id, value from setting_values where key = 'tracker' order by project_id")
      return Object.fromEntries(rows.rows.map((row) => [row.project_id ?? 'null', JSON.parse(row.value)]))
    } finally {
      await opened.close()
    }
  }

  it('of version 12 gives each project without a tracker of its own Huly, the default of then (BTN-345)', async () => {
    expect(await trackersOfV12()).toEqual({ [ABC]: 'huly', [XYZ]: 'github', [SECOND_ABC]: 'huly' })
  })

  it('of version 12 gives them the shared tracker it had, and drops the shared row (BTN-345)', async () => {
    const shared = `insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by)
      values ('tracker', null, '', '"linear"', '2026-10-18T09:00:00.000Z', 'hand');`
    expect(await trackersOfV12(shared)).toEqual({ [ABC]: 'linear', [XYZ]: 'github', [SECOND_ABC]: 'linear' })
  })
})
