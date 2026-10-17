import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadLedger } from '../account/ledger.js'
import { fixEpisodes, isLaunch } from '../chain/launches.js'
import { loadChainState, loadQuestions, readLaunches } from '../chain/store.js'
import { parseSession } from '../codex/turns.js'
import { parseConfig } from '../config.js'
import { root } from '../locations.js'
import { upgradeStorage } from './migrations.js'
import { SCHEMA_VERSION } from './schema.js'

// Frozen samples of the files as the current schema version writes them: a change of the format that breaks reading
// them needs a new version, a migration step and a new sample next to this one, not an edit of this one.
const samples = join(root, 'test', 'fixtures', `schema-v${SCHEMA_VERSION}`)
const sample = (name: string) => join(samples, name)
const json = (name: string) => JSON.parse(readFileSync(sample(name), 'utf8'))

const ABC = '11111111-1111-4111-8111-111111111111'
const XYZ = '22222222-2222-4222-8222-222222222222'

describe(`frozen samples of schema v${SCHEMA_VERSION}`, () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('reads the config', () => {
    const config = parseConfig(json('even-keel.config.json'))
    expect(config.ids).toEqual({ ABC, XYZ })
    expect(config.projects).toEqual({ ABC: 'C:\\repos\\example-project', XYZ: 'C:\\repos\\other-project' })
    expect(config.slots).toEqual({ XYZ: 2 })
    expect(config.settings.ABC?.afterGreen).toEqual(['npm run build', 'pwsh -File service/restart.ps1'])
    expect(config.settings.ABC).toMatchObject({ agent: 'claude', codexModel: null })
    expect(config.settings.XYZ).toMatchObject({ agent: 'codex', codexModel: 'gpt-5.6-luna' })
  })

  it('reads the record of a Codex session', () => {
    const session = parseSession(readFileSync(sample('state/codex/sessions/00000000-0000-4000-8000-0000000000c1.json'), 'utf8'))
    expect(session).toMatchObject({ sessionId: '00000000-0000-4000-8000-0000000000c1', name: 'XYZ-7', account: 'codex', pid: 4242 })
  })

  it('reads the chain naming projects by their keys', () => {
    const state = loadChainState(sample('state/chain.json'), { ABC, XYZ })
    expect(state.active.map((chain) => [chain.project, chain.current?.task])).toEqual([['ABC', 'ABC-2']])
    expect(state.queue).toEqual(['XYZ'])
    expect(state.orders).toEqual({ ABC: ['ABC-1', 'ABC-2', 'ABC-3'], XYZ: ['XYZ-7'] })
    expect(Object.keys(state.skipped)).toEqual(['ABC'])
    expect(state.leftovers.XYZ?.[0]?.task).toBe('XYZ-1')
    expect(state.released).toEqual({ ABC: ['ABC-1'] })
    expect(Object.keys(state.ci)).toEqual(['ABC'])
    expect(state.ci.ABC?.afterGreen).toBe(state.ci.ABC?.green)
  })

  it('reads the questions, the launches and the accounts', () => {
    expect(loadQuestions(sample('state/questions.json')).map((question) => question.task)).toEqual(['ABC-2'])
    const launches = readLaunches(sample('state/launches.jsonl'), { ABC, XYZ })
    expect(launches.filter(isLaunch).map((entry) => [entry.project, entry.task])).toEqual([
      ['ABC', 'ABC-1'],
      ['ABC', 'ABC-2'],
      ['ABC', 'ABC-FIX'],
      ['ABC', 'ABC-FIX'],
    ])
    expect(fixEpisodes(launches).episodes.ABC?.map((episode) => [episode.id, episode.red?.slice(0, 7), episode.end?.how, episode.end?.commit?.slice(0, 7)])).toEqual([
      ['ABC-FIX.1', 'c6b3956', 'landed', '15945fe'],
      ['ABC-FIX.2', 'd00d000', 'dropped', undefined],
    ])
    expect(new Set(readLaunches(sample('state/launches.jsonl')).map((entry) => entry.project))).toEqual(new Set([ABC]))
    const ledger = loadLedger(sample('state/account.json'))
    expect(ledger.accounts.global?.email).toBe('john.doe@example.com')
    expect(ledger.accounts['team-api']?.name).toBe('Team API')
  })

  it('is current: the migration writes nothing', () => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-samples-'))
    cpSync(samples, dir, { recursive: true })
    const before = filesOf(dir)
    const logs: string[] = []
    upgradeStorage({ configFile: join(dir, 'even-keel.config.json'), stateDir: join(dir, 'state'), log: (line) => logs.push(line) })
    expect(logs).toEqual([])
    expect(filesOf(dir)).toEqual(before)
  })

  it('matches the example config of the repository', () => {
    const example = JSON.parse(readFileSync(join(root, 'even-keel.config.example.json'), 'utf8'))
    expect(example.version).toBe(SCHEMA_VERSION)
    expect(Object.keys(parseConfig(example).ids)).toEqual(['ABC', 'XYZ', 'GHB'])
  })
})

function filesOf(dir: string): Record<string, string> {
  const files: Record<string, string> = {}
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    files[relative(dir, path)] = readFileSync(path, 'utf8')
  }
  return files
}
