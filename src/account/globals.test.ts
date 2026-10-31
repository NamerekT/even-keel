import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { memoryDatabase } from '../storage/memory.js'
import { openDatabase, STEPS } from '../storage/database.js'
import { backupDatabase } from '../storage/copy.js'
import { dataDirOf } from '../storage/owner.js'
import { prepareDatabase } from '../storage/state-files.js'
import { PGlite } from '@electric-sql/pglite'
import { fixture, schemaOf } from '../storage/database.fixture.js'
import { openAccountHomes } from './globals.js'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function environment() {
  const root = mkdtempSync(join(tmpdir(), 'even-keel-globals-'))
  roots.push(root)
  const env = {
    CLAUDE_CONFIG_DIR: join(root, '.claude'), CODEX_HOME: join(root, '.codex'),
    EVEN_KEEL_ACCOUNTS_DIR: join(root, 'claude'), EVEN_KEEL_CODEX_ACCOUNTS_DIR: join(root, 'codex'),
    EVEN_KEEL_OPENCODE_ACCOUNTS_DIR: join(root, 'opencode'), EVEN_KEEL_COPILOT_ACCOUNTS_DIR: join(root, 'copilot'),
  }
  mkdirSync(env.CLAUDE_CONFIG_DIR)
  mkdirSync(env.CODEX_HOME)
  writeFileSync(join(env.CODEX_HOME, 'auth.json'), '{"example":"unchanged"}')
  return env
}

it('keeps existing CLI folders hidden on a fresh install until explicitly added, persisting add and removal', async () => {
  const db = await memoryDatabase()
  const env = environment()
  const homes = await openAccountHomes(db, env)
  expect(homes.list()).toEqual([])
  expect(homes.ownerOf(null)).toBeUndefined()
  const codex = homes.availableGlobals().find((home) => home.agent === 'codex')!
  await homes.register(codex)
  expect((await openAccountHomes(db, env)).find('codex')).toEqual(codex)
  await homes.remove(codex)
  expect((await openAccountHomes(db, env)).list()).toEqual([])
  expect(readFileSync(join(env.CODEX_HOME, 'auth.json'), 'utf8')).toBe('{"example":"unchanged"}')
}, 30_000)

it('adopts only the global folders visible at upgrade, once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'even-keel-upgrade-'))
  roots.push(root)
  const old = await PGlite.create({ dataDir: join(root, 'db') })
  await old.exec(fixture(16))
  await old.close()
  const db = await openDatabase(join(root, 'db'))
  try {
    const env = environment()
    rmSync(env.CODEX_HOME, { recursive: true })
    const homes = await openAccountHomes(db, env)
    expect(homes.list().map((home) => home.key)).toEqual(['global'])
    mkdirSync(env.CODEX_HOME)
    expect((await openAccountHomes(db, env)).list().map((home) => home.key)).toEqual(['global'])
    await homes.remove(homes.find('global')!)
    expect((await openAccountHomes(db, env)).list()).toEqual([])
  } finally { await db.close() }
}, 30_000)

it('has a frozen schema sample for the registration table', async () => {
  const made = await openDatabase(undefined, STEPS.slice(0, 15))
  const frozen = await PGlite.create()
  try {
    await frozen.exec(fixture(17))
    expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
    const env = environment()
    expect((await openAccountHomes(frozen, env)).list().map((home) => home.key)).toEqual(['global', 'codex'])
    const copyDir = join(roots[0]!, 'backup')
    // A backup is of the current version: the sample is brought there first, as the service's start would.
    for (const step of STEPS.slice(15)) await frozen.exec(step)
    await backupDatabase(frozen, copyDir)
    const copy = await openDatabase(dataDirOf(copyDir))
    try {
      expect((await openAccountHomes(copy, env)).list().map((home) => home.key)).toEqual(['global', 'codex'])
    } finally { await copy.close() }
  } finally { await Promise.all([frozen.close(), made.close()]) }
}, 30_000)

it('preserves an old installation whose only saved state is its account ledger', async () => {
  const env = environment()
  const stateDir = join(roots[0]!, 'state')
  mkdirSync(stateDir)
  writeFileSync(join(stateDir, 'account.json'), '{"version":17,"accounts":{}}')
  const opened = await prepareDatabase({ stateDir, log: () => {} })
  try {
    expect((await openAccountHomes(opened.db, env)).list().map((home) => home.key)).toEqual(['global', 'codex'])
  } finally { await opened.close() }
}, 30_000)
