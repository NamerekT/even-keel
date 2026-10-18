import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chainStateOf, loadChainState, loadQuestions, readLaunches } from '../chain/store.js'
import { root } from '../locations.js'
import { upgradeStorage } from './migrations.js'
import { IMPORTED_SUFFIX, prepareDatabase, readStateFiles, STATE_FILES } from './state-files.js'

// Apart from state-files.test.ts so that the two run side by side: together they were the longest file of the run.
describe.each([2, 3, 4, 5, 6, 7, 8, 9])('the frozen sample of schema v%i', { timeout: 120_000 }, (version) => {
  let dir: string
  let stateDir: string
  let logs: string[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-db-'))
    stateDir = join(dir, 'state')
    mkdirSync(stateDir)
    logs = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const prepare = () => prepareDatabase({ stateDir, log: (line) => logs.push(line) })
  const listing = () => readdirSync(stateDir).sort()

  it('moves into the database whole, keeps the files as imported and does it once', async () => {
    cpSync(join(root, 'test', 'fixtures', `schema-v${version}`), dir, { recursive: true })
    upgradeStorage({ configFile: join(dir, 'even-keel.config.json'), stateDir, log: () => {} })
    const files = readStateFiles(stateDir)!
    const { db, close } = await prepare()
    try {
      expect(await loadChainState(db)).toEqual(chainStateOf(files.chain, {}, 'chain.json'))
      expect(await loadQuestions(db)).toEqual(files.questions)
      expect(await readLaunches(db)).toEqual(files.launches)
      expect((await readLaunches(db)).length).toBeGreaterThan(0)
    } finally {
      await close()
    }
    for (const name of [STATE_FILES.chain, STATE_FILES.questions, STATE_FILES.launches]) {
      expect(existsSync(join(stateDir, name))).toBe(false)
      expect(existsSync(join(stateDir, `${name}${IMPORTED_SUFFIX}`))).toBe(true)
    }
    expect(logs).toEqual([expect.stringMatching(/moved the state into/)])
    const before = listing()
    await (await prepare()).close()
    expect(listing()).toEqual(before)
    expect(logs).toHaveLength(1)
  })
})
