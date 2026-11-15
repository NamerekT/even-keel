import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parseConfig } from '../config.js'
import { StatsReader } from './reader.js'
import { builtTallyVersion, TALLY_SCHEMA_VERSION } from './tally-schema.js'

const proxy = vi.hoisted(() => ({ version: 0 }))
vi.mock('pg', () => ({ default: { Client: class {}, Pool: class {
  on() {}
  end() { return Promise.resolve() }
  query(sql: string) {
    if (sql.includes('to_regclass')) return Promise.resolve({ rows: [{ present: true }] })
    if (sql.includes('schema_version')) return Promise.resolve({ rows: [{ version: proxy.version }] })
    return Promise.resolve({ rows: [] })
  }
} } }))

const settings = { host: 'localhost', port: 1, database: 'tally', user: 'reader', password: 'fake' }
const config = parseConfig({ projects: [] }).stats
const reader = (built: number) => new StatsReader(settings, () => ({ ABC: 'C:/example' }), () => config, undefined, undefined, () => built)

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tally-steps-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

// BTN-1208: a build on disk newer than the running service is a missing restart, not a rollback.
it('asks for a restart when the build on disk knows the database version', async () => {
  proxy.version = TALLY_SCHEMA_VERSION + 1
  expect(await reader(TALLY_SCHEMA_VERSION + 1).spend('UTC')).toEqual({ state: 'newer', version: TALLY_SCHEMA_VERSION + 1, known: TALLY_SCHEMA_VERSION, restart: true })
})

it('keeps the rollback when the build on disk does not know the database version either', async () => {
  proxy.version = TALLY_SCHEMA_VERSION + 2
  expect(await reader(TALLY_SCHEMA_VERSION + 1).spend('UTC')).toEqual({ state: 'newer', version: TALLY_SCHEMA_VERSION + 2, known: TALLY_SCHEMA_VERSION, restart: false })
})

it('reads the build version from the numbered step files', () => {
  for (const file of ['schema.sql', '2-first.sql', '17-later.sql', 'notes.txt']) writeFileSync(join(dir, file), '')
  expect(builtTallyVersion(dir)).toBe(17)
  expect(builtTallyVersion(join(dir, 'missing'))).toBe(0)
  expect(builtTallyVersion()).toBe(TALLY_SCHEMA_VERSION)
})
