import type { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../storage/database.js'
import { stateValue } from '../storage/service-state.js'
import { ADAPTERS } from '../tracker/adapters.js'
import type { TrackerProfile } from './model.js'
import { importForgejo, importProfiles, readProfiles, saveProfiles } from './store.js'

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

  it('preserves the optional Jira MCP token separately from the REST token', async () => {
    const values = { JIRA_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'john.doe@example.com', JIRA_TOKEN: 'rest-token', JIRA_MCP_TOKEN: 'mcp-token' }
    const set = { profiles: [profile('jira', 'jira', true, values)], links: {} }
    await saveProfiles(db, set)
    expect(await readProfiles(db)).toEqual(set)
  })

  it("keeps each profile's chain rules and each extra feed's profile (BTN-66)", async () => {
    const set = {
      profiles: [{ ...profile('a', 'github', true), rules: { active: ['open'], excludedLabels: ['wontfix'] } }, profile('c', 'huly', true, HULY_ENV)],
      links: { [XYZ]: 'a' },
      feeds: { 'feed-1': 'a' },
    }
    await saveProfiles(db, set)
    expect(await readProfiles(db)).toEqual(set)
    const next = { ...set, profiles: [profile('a', 'github', true), set.profiles[1]!], feeds: {} }
    await saveProfiles(db, next)
    expect(await readProfiles(db)).toEqual({ profiles: next.profiles, links: next.links })
  })

  it('refuses to drop a profile a feed still runs on', async () => {
    await saveProfiles(db, { profiles: [profile('a', 'github', true)], links: {}, feeds: { 'feed-1': 'a' } })
    await expect(db.transaction((tx) => tx.query("delete from tracker_profiles where id = 'a'"))).rejects.toThrow(/foreign key/)
  })

  describe('importForgejo', () => {
    const forgejoFrom = (env: Record<string, string | undefined>, webs: string[]) =>
      importForgejo({ db, env, webs: async () => webs, log: (line) => logs.push(line) })

    it('makes FORGEJO_TOKEN a profile per host of the projects\' Forgejo remotes, the first one default, once', async () => {
      await importFrom({ ...HULY_ENV })
      const env = { FORGEJO_TOKEN: 'forgejo-token' }
      const imported = await forgejoFrom(env, ['https://git.example.com', 'https://GIT.example.com/sub', 'https://forgejo.example.org'])
      expect(imported.profiles.map((each) => [each.kind, each.name, each.values, each.isDefault])).toEqual([
        ['huly', 'Huly · example', HULY_ENV, true],
        ['forgejo', 'Forgejo · git.example.com', { FORGEJO_URL: 'https://git.example.com', FORGEJO_TOKEN: 'forgejo-token' }, true],
        ['forgejo', 'Forgejo · forgejo.example.org', { FORGEJO_URL: 'https://forgejo.example.org', FORGEJO_TOKEN: 'forgejo-token' }, false],
      ])
      expect(await readProfiles(db)).toEqual(imported)
      expect(logs.at(-1)).toContain('FORGEJO_TOKEN of .env became the profiles Forgejo · git.example.com, Forgejo · forgejo.example.org')

      expect(await forgejoFrom({ FORGEJO_TOKEN: 'other' }, ['https://other.example.com'])).toEqual(imported)
    })

    it('without the variable makes nothing and says nothing; without a Forgejo remote it says the token is left', async () => {
      expect(await forgejoFrom({}, ['https://git.example.com'])).toEqual({ profiles: [], links: {} })
      expect(logs).toEqual([])
      await db.query("delete from service_state where name = 'profiles.forgejo.imported'")
      expect(await forgejoFrom({ FORGEJO_TOKEN: 'forgejo-token' }, [])).toEqual({ profiles: [], links: {} })
      expect(logs).toEqual([expect.stringContaining('no project has a Forgejo remote')])
      expect(await stateValue(db, 'profiles.forgejo.imported')).toBeDefined()
    })
  })

  it('refuses to drop a profile a project still runs on', async () => {
    await saveProfiles(db, { profiles: [profile('a', 'github', true)], links: { [XYZ]: 'a' } })
    await expect(db.transaction((tx) => tx.query("delete from tracker_profiles where id = 'a'"))).rejects.toThrow(/foreign key/)
  })
})
