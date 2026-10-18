import type { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../storage/database.js'
import { stateValue } from '../storage/service-state.js'
import { ADAPTERS } from '../tracker/adapters.js'
import type { TrackerProfile } from './model.js'
import { importProfiles, readProfiles, saveProfiles } from './store.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const XYZ = '22222222-2222-4222-8222-222222222222'
const LMN = '33333333-3333-4333-8333-333333333333'

const HULY_ENV = { HULY_URL: 'https://huly.example.com', HULY_WORKSPACE: 'example', HULY_TOKEN: 'example-token' }

const profile = (id: string, kind: string, isDefault: boolean, values: Record<string, string> = {}): TrackerProfile => ({
  id,
  kind,
  name: `${kind} ${id}`,
  values,
  isDefault,
  login: null,
  expiresAt: null,
})

describe('profile store', { timeout: 60_000 }, () => {
  let db: PGlite
  let logs: string[]
  beforeEach(async () => {
    db = await openDatabase(undefined)
    logs = []
    await db.query(
      `insert into projects (id, key, name, repo, branch, tracker_projects, position) values
         ($1, 'ABC', null, 'C:\\repos\\abc', 'main', '{}', 0), ($2, 'XYZ', null, 'C:\\repos\\xyz', 'main', '{}', 1), ($3, 'LMN', null, 'C:\\repos\\lmn', 'main', '{}', 2)`,
      [ABC, XYZ, LMN],
    )
  })
  afterEach(() => db.close())

  const importFrom = (env: Record<string, string | undefined>) =>
    importProfiles({ db, env, adapters: ADAPTERS, trackers: { [ABC]: 'huly', [XYZ]: 'github', [LMN]: 'huly' }, log: (line) => logs.push(line) })

  it('makes each tracker of the environment the default profile of its kind, and links its projects, once', async () => {
    const imported = await importFrom({ ...HULY_ENV, GITHUB_TOKEN: 'github_pat_example', PATH: 'C:\\Windows' })
    expect(imported.profiles.map((each) => [each.kind, each.name, each.values, each.isDefault])).toEqual([
      ['huly', 'Huly · example', HULY_ENV, true],
      ['github', 'GitHub', { GITHUB_TOKEN: 'github_pat_example' }, true],
    ])
    const [hulyProfile, githubProfile] = imported.profiles
    expect(imported.links).toEqual({ [ABC]: hulyProfile!.id, [XYZ]: githubProfile!.id, [LMN]: hulyProfile!.id })
    expect(await readProfiles(db)).toEqual(imported)
    expect(await stateValue(db, 'profiles.imported')).toBeDefined()
    expect(logs).toEqual([expect.stringContaining('Huly · example (2 projects), GitHub (1 projects)')])

    expect(await importFrom({ LINEAR_TOKEN: 'lin_api_example' })).toEqual(imported)
    expect(logs).toHaveLength(1)
  })

  it('leaves out a tracker whose variables are set only in part, with a line', async () => {
    const imported = await importFrom({ HULY_URL: 'https://huly.example.com' })
    expect(imported).toEqual({ profiles: [], links: {} })
    expect(logs).toEqual([expect.stringContaining('the Huly variables of .env make no profile')])
    expect(await stateValue(db, 'profiles.imported')).toBeDefined()
  })

  it('saves the set whole: a profile it lacks goes, the default moves, a project it does not name loses its link', async () => {
    await saveProfiles(db, {
      profiles: [profile('a', 'github', true), profile('b', 'github', false), profile('c', 'huly', true, HULY_ENV)],
      links: { [ABC]: 'c', [XYZ]: 'b' },
    })
    const next = { profiles: [profile('b', 'github', true), profile('c', 'huly', true, HULY_ENV)], links: { [XYZ]: 'b' } }
    await saveProfiles(db, next)
    expect(await readProfiles(db)).toEqual(next)
  })

  it('refuses to drop a profile a project still runs on', async () => {
    await saveProfiles(db, { profiles: [profile('a', 'github', true)], links: { [XYZ]: 'a' } })
    await expect(db.transaction((tx) => tx.query("delete from tracker_profiles where id = 'a'"))).rejects.toThrow(/foreign key/)
  })
})
