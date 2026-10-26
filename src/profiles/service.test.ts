import type { PGlite } from '@electric-sql/pglite'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NoticeError } from '../notice/notice.js'
import { FORGEJO_PROFILE } from '../ci/forgejo-profile.js'
import { openDatabase, Writes } from '../storage/database.js'
import { CredentialsRefused, type TrackerAdapter } from '../tracker/source.js'
import { profileKinds, type ProfileKind, type ProfileSet, type TrackerProfile } from './model.js'
import { Profiles, type ProfilesDeps } from './service.js'
import { readProfiles } from './store.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const XYZ = '22222222-2222-4222-8222-222222222222'

/** A token `bad` is refused, `down` gets no answer; any other signs in as `<token>-user`. */
const fake = {
  title: 'Fake',
  variables: ['FAKE_URL', 'FAKE_TOKEN'],
  hostVariables: ['FAKE_URL'],
  help: 'https://fake.example.com/tokens',
  profileName: (values: Record<string, string>) => `Fake · ${values.FAKE_URL}`,
  account: async (values: Record<string, string>) => {
    if (values.FAKE_TOKEN === 'bad') throw new CredentialsRefused('401 Unauthorized')
    if (values.FAKE_TOKEN === 'down') throw new Error('ECONNREFUSED')
    return { login: `${values.FAKE_TOKEN}-user`, name: `Fake · ${values.FAKE_TOKEN}`, expiresAt: null }
  },
  projects: async (_values: Record<string, string>, query: string) => [{ key: 'ABC', name: `Project ${query}` }],
  setup: (env: Record<string, string | undefined>) => {
    const set = ['FAKE_URL', 'FAKE_TOKEN'].filter((name) => env[name])
    if (set.length === 0) return undefined
    if (set.length < 2) throw new Error('FAKE_URL and FAKE_TOKEN go together')
    return { connect: () => Promise.reject(new Error('not here')), issueUrl: () => null }
  },
} as unknown as TrackerAdapter

/** A CI's kind: no projects, so no project runs on it and the sessions never get its values. */
const ciFake: ProfileKind = {
  title: 'CI fake',
  variables: ['CIFAKE_URL', 'CIFAKE_TOKEN'],
  hostVariables: ['CIFAKE_URL'],
  help: 'https://ci.example.com/tokens',
  profileName: (values) => `CI fake · ${values.CIFAKE_URL}`,
  account: async (values) => ({ login: `${values.CIFAKE_TOKEN}-user`, name: 'CI fake', expiresAt: null }),
  complete: (values) => Boolean(values.CIFAKE_URL && values.CIFAKE_TOKEN),
}

const profile = (id: string, token: string, isDefault: boolean): TrackerProfile => ({
  id,
  kind: 'fake',
  name: `Fake ${id}`,
  values: { FAKE_URL: 'https://fake.example.com', FAKE_TOKEN: token },
  isDefault,
  login: null,
  expiresAt: null,
})

describe('Profiles', { timeout: 60_000 }, () => {
  let db: PGlite
  let writes: Writes
  let settingsFile: string
  let changes: ProfileSet[]
  let expired: number
  beforeEach(async () => {
    db = await openDatabase(undefined)
    writes = new Writes((line) => {
      throw new Error(line)
    })
    settingsFile = join(mkdtempSync(join(tmpdir(), 'profiles-')), 'settings.json')
    writeFileSync(settingsFile, JSON.stringify({ model: 'opus', env: { OTHER: 'x' } }))
    changes = []
    expired = 0
    await db.query(
      `insert into projects (id, key, name, repo, branch, tracker_projects, position) values
         ($1, 'ABC', null, 'C:\\repos\\abc', 'main', '{}', 0), ($2, 'XYZ', null, 'C:\\repos\\xyz', 'main', '{}', 1)`,
      [ABC, XYZ],
    )
  })
  afterEach(async () => {
    await writes.settled()
    await db.close()
  })

  const make = (set: ProfileSet = { profiles: [], links: {} }, overrides: Partial<ProfilesDeps> = {}) =>
    new Profiles({
      db,
      writes,
      kinds: profileKinds({ fake }, { cifake: ciFake }),
      set,
      projects: () => ({ [ABC]: { key: 'ABC', kind: 'fake' }, [XYZ]: { key: 'XYZ', kind: 'fake' } }),
      settingsFile: () => settingsFile,
      expired: () => expired++,
      timeoutMs: 1000,
      now: () => new Date('2026-10-18T12:00:00Z'),
      log: () => {},
      onChange: (next) => changes.push(next),
      ...overrides,
    })
  const sessionEnv = () => (JSON.parse(readFileSync(settingsFile, 'utf8')) as { env?: Record<string, string> }).env ?? {}
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise
    } catch (error) {
      return error instanceof NoticeError ? error.notice.code : (error as Error).message
    }
    return 'resolved'
  }

  describe('check', () => {
    it('reports a GitLab host as GitLab without an untranslated detail', async () => {
      const profiles = make(undefined, { kinds: profileKinds({}, { forgejo: FORGEJO_PROFILE }) })
      await expect(profiles.check({ kind: 'forgejo', values: { FORGEJO_URL: 'https://gitlab.com', FORGEJO_TOKEN: 'example-token' } }))
        .rejects.toMatchObject({ notice: { code: 'profiles.isGitlab', params: { host: 'gitlab.com' } } })
    })
    it('says whom the values sign in as and what to name the profile', async () => {
      const result = await make().check({ kind: 'fake', values: { FAKE_URL: 'https://fake.example.com', FAKE_TOKEN: 'abc' } })
      expect(result).toEqual({ login: 'abc-user', name: 'Fake · abc', expiresAt: null, duplicate: null })
    })

    it('names the profile already signed in as the same account on the same host', async () => {
      const stored = { ...profile('p1', 'abc', true), login: 'abc-user' }
      const result = await make({ profiles: [stored], links: {} }).check({ kind: 'fake', values: { FAKE_URL: 'https://fake.example.com/', FAKE_TOKEN: 'abc' } })
      expect(result.duplicate).toBe('Fake p1')
    })

    it('tells a refused token from a host that does not answer, and an incomplete set from both', async () => {
      const profiles = make()
      expect(await codeOf(profiles.check({ kind: 'fake', values: { FAKE_URL: 'https://fake.example.com', FAKE_TOKEN: 'bad' } }))).toBe('profiles.refused')
      expect(await codeOf(profiles.check({ kind: 'fake', values: { FAKE_URL: 'https://fake.example.com', FAKE_TOKEN: 'down' } }))).toBe('profiles.unreachable')
      expect(await codeOf(profiles.check({ kind: 'fake', values: { FAKE_URL: 'https://fake.example.com' } }))).toBe('profiles.incomplete')
      expect(await codeOf(profiles.check({ kind: 'nope', values: {} }))).toBe('profiles.unknownKind')
    })

    it('keeps the stored secret of an existing profile when the page leaves it empty', async () => {
      const result = await make({ profiles: [profile('p1', 'abc', true)], links: {} }).check({ id: 'p1', kind: 'fake', values: { FAKE_URL: 'https://fake.example.com', FAKE_TOKEN: '' } })
      expect(result.login).toBe('abc-user')
    })
  })

  describe('save', () => {
    it('stores a checked profile as its kind\'s default and hands its values to the sessions', async () => {
      const profiles = make()
      const id = await profiles.save({ kind: 'fake', name: '', values: { FAKE_URL: 'https://fake.example.com', FAKE_TOKEN: 'abc' } })
      await writes.settled()
      const stored = await readProfiles(db)
      expect(stored.profiles).toEqual([{ id, kind: 'fake', name: 'Fake · abc', values: { FAKE_URL: 'https://fake.example.com', FAKE_TOKEN: 'abc' }, isDefault: true, login: 'abc-user', expiresAt: null }])
      expect(sessionEnv()).toEqual({ OTHER: 'x', FAKE_URL: 'https://fake.example.com', FAKE_TOKEN: 'abc' })
      expect(changes).toHaveLength(1)
      expect(profiles.view().profiles[0]).toMatchObject({ id, check: { state: 'ok', error: null }, projects: ['ABC', 'XYZ'] })
    })

    it('makes a second profile of a kind not default and leaves the sessions\' values alone', async () => {
      const profiles = make({ profiles: [profile('p1', 'abc', true)], links: {} })
      const id = await profiles.save({ kind: 'fake', name: 'Org', values: { FAKE_URL: 'https://fake.example.com', FAKE_TOKEN: 'org' } })
      expect(profiles.current().profiles.find((each) => each.id === id)).toMatchObject({ name: 'Org', isDefault: false })
      expect(sessionEnv()).toEqual({ OTHER: 'x' })
    })

    it('refuses to save values the tracker refuses', async () => {
      const profiles = make()
      expect(await codeOf(profiles.save({ kind: 'fake', name: '', values: { FAKE_URL: 'https://fake.example.com', FAKE_TOKEN: 'bad' } }))).toBe('profiles.refused')
      expect(profiles.current().profiles).toEqual([])
    })

    it('keeps the host of a profile projects run on, but takes a new token', async () => {
      const profiles = make({ profiles: [profile('p1', 'abc', true)], links: { [ABC]: 'p1' } })
      expect(await codeOf(profiles.save({ id: 'p1', kind: 'fake', name: 'Fake p1', values: { FAKE_URL: 'https://other.example.com', FAKE_TOKEN: '' } }))).toBe('profiles.hostLocked')
      await profiles.save({ id: 'p1', kind: 'fake', name: 'Renamed', values: { FAKE_URL: 'https://fake.example.com', FAKE_TOKEN: 'new' } })
      expect(profiles.current().profiles[0]).toMatchObject({ name: 'Renamed', values: { FAKE_TOKEN: 'new' }, login: 'new-user' })
    })
  })

  describe('remove', () => {
    it('refuses while projects run on the profile and names them', async () => {
      const profiles = make({ profiles: [profile('p1', 'abc', true), profile('p2', 'org', false)], links: { [XYZ]: 'p2' } })
      let error: unknown
      try {
        profiles.remove('p2')
      } catch (caught) {
        error = caught
      }
      expect((error as NoticeError).notice).toMatchObject({ code: 'profiles.inUse', params: { profile: 'Fake p2', projects: 'XYZ' } })
    })

    it('makes the next profile of the kind default when the default goes, and its values reach the sessions', async () => {
      const profiles = make({ profiles: [profile('p1', 'abc', true), profile('p2', 'org', false)], links: {} }, { projects: () => ({}) })
      profiles.remove('p1')
      expect(profiles.current().profiles).toEqual([{ ...profile('p2', 'org', true) }])
      expect(sessionEnv()).toMatchObject({ FAKE_TOKEN: 'org' })
      expect(expired).toBe(0)
    })

    it('takes the kind\'s values out of the sessions when its last profile goes', async () => {
      writeFileSync(settingsFile, JSON.stringify({ env: { OTHER: 'x', FAKE_URL: 'u', FAKE_TOKEN: 't' } }))
      const profiles = make({ profiles: [profile('p1', 'abc', true)], links: {} }, { projects: () => ({}) })
      profiles.remove('p1')
      expect(sessionEnv()).toEqual({ OTHER: 'x' })
      expect(expired).toBe(1)
    })
  })

  it('moves the default and links a project to a profile of its tracker only', async () => {
    const profiles = make({ profiles: [profile('p1', 'abc', true), profile('p2', 'org', false)], links: {} })
    profiles.setDefault('p2')
    expect(profiles.current().profiles.map((each) => each.isDefault)).toEqual([false, true])
    expect(sessionEnv()).toMatchObject({ FAKE_TOKEN: 'org' })
    profiles.link(ABC, 'p1')
    expect(profiles.current().links).toEqual({ [ABC]: 'p1' })
    profiles.link(ABC, null)
    expect(profiles.current().links).toEqual({})
    expect(() => profiles.link(ABC, 'missing')).toThrow(NoticeError)
  })

  it('keeps a locked project or feed on the old default when the default moves, the rest follow it (BTN-435)', async () => {
    const FEED = 'feed-1'
    const lines: string[] = []
    const profiles = make(
      { profiles: [profile('p1', 'abc', true), profile('p2', 'org', false)], links: {} },
      {
        projects: () => ({ [ABC]: { key: 'ABC', kind: 'fake' }, [XYZ]: { key: 'XYZ', kind: 'fake' }, [FEED]: { key: 'ABCF', kind: 'fake', feed: true } }),
        locked: () => [ABC, FEED],
        log: (line) => lines.push(line),
      },
    )
    profiles.setDefault('p2')
    expect(profiles.current()).toMatchObject({ links: { [ABC]: 'p1' }, feeds: { [FEED]: 'p1' } })
    expect(profiles.view().profiles.map((each) => each.projects)).toEqual([['ABC', 'ABCF'], ['XYZ']])
    expect(lines).toEqual(['profiles: ABC, ABCF stay on Fake p1: the chain has started their tasks'])
    await writes.settled()
    expect(await readProfiles(db)).toMatchObject({ links: { [ABC]: 'p1' }, feeds: { [FEED]: 'p1' } })
  })

  it('leaves a locked project linked to another profile as it is when the default moves', async () => {
    const profiles = make({ profiles: [profile('p1', 'abc', true), profile('p2', 'org', false)], links: { [ABC]: 'p2' } }, { locked: () => [ABC] })
    profiles.setDefault('p2')
    expect(profiles.current().links).toEqual({ [ABC]: 'p2' })
  })

  it("links a feed apart from the projects, and a feed on a profile keeps it from going (BTN-66)", async () => {
    const FEED = 'feed-1'
    const profiles = make(
      { profiles: [profile('p1', 'abc', true), profile('p2', 'org', false)], links: {} },
      { projects: () => ({ [ABC]: { key: 'ABC', kind: 'fake' }, [FEED]: { key: 'ABCF', kind: 'fake' } }) },
    )
    profiles.link(FEED, 'p2', true)
    expect(profiles.current()).toMatchObject({ links: {}, feeds: { [FEED]: 'p2' } })
    expect(() => profiles.remove('p2')).toThrow(NoticeError)
    profiles.link(FEED, null, true)
    expect(profiles.current().feeds).toEqual({})
  })

  it('sets the chain rules of a profile once its projects take them, and shows them (BTN-66)', async () => {
    const refused: string[] = []
    const profiles = make(
      { profiles: [profile('p1', 'abc', true)], links: {} },
      {
        checkRules: (_set, id, rules) => {
          if (rules.terminal?.includes('Todo')) {
            refused.push(id)
            throw new Error('clash')
          }
        },
      },
    )
    profiles.setRules('p1', { active: [' Open ', ''], terminal: ['Closed'] })
    expect(profiles.current().profiles[0]!.rules).toEqual({ active: ['Open'], terminal: ['Closed'] })
    expect(profiles.view().profiles[0]).toMatchObject({ rules: { active: ['Open'], terminal: ['Closed'] }, projectIds: [ABC, XYZ] })
    expect(() => profiles.setRules('p1', { terminal: ['Todo'] })).toThrow('clash')
    expect(refused).toEqual(['p1'])
    profiles.setRules('p1', {})
    expect(profiles.current().profiles[0]).toEqual(profile('p1', 'abc', true))
    await writes.settled()
    expect((await readProfiles(db)).profiles[0]).toEqual(profile('p1', 'abc', true))
    expect(() => profiles.setRules('missing', {})).toThrow(NoticeError)
  })

  it('a recheck marks a refused profile and the projects that run on it', async () => {
    const profiles = make({ profiles: [profile('p1', 'bad', true), profile('p2', 'abc', false)], links: { [XYZ]: 'p2' } })
    await profiles.recheck()
    expect(profiles.view().profiles.map((each) => each.check.state)).toEqual(['refused', 'ok'])
    expect(profiles.refused(ABC)?.name).toBe('Fake p1')
    expect(profiles.refused(XYZ)).toBeUndefined()
  })

  it('a host that does not answer is no refusal', async () => {
    const profiles = make({ profiles: [profile('p1', 'down', true)], links: {} })
    await profiles.recheck()
    expect(profiles.view().profiles[0]!.check.state).toBe('unreachable')
    expect(profiles.refused(ABC)).toBeUndefined()
  })

  it('shows secrets as set only, and the kinds a profile can be made for', () => {
    const view = make({ profiles: [profile('p1', 'abc', true)], links: {} }).view()
    expect(view.profiles[0]!.fields).toEqual([
      { name: 'FAKE_URL', secret: false, set: true, value: 'https://fake.example.com' },
      { name: 'FAKE_TOKEN', secret: true, set: true, value: null },
    ])
    expect(view.kinds).toEqual([
      { kind: 'fake', title: 'Fake', tracker: true, fields: [{ name: 'FAKE_URL', secret: false }, { name: 'FAKE_TOKEN', secret: true }], hostVariables: ['FAKE_URL'], alternatives: [], help: 'https://fake.example.com/tokens' },
      { kind: 'cifake', title: 'CI fake', tracker: false, fields: [{ name: 'CIFAKE_URL', secret: false }, { name: 'CIFAKE_TOKEN', secret: true }], hostVariables: ['CIFAKE_URL'], alternatives: [], help: 'https://ci.example.com/tokens' },
    ])
  })

  it('lists the projects a profile sees', async () => {
    expect(await make({ profiles: [profile('p1', 'abc', true)], links: {} }).projects('p1', 'x')).toEqual([{ key: 'ABC', name: 'Project x' }])
  })

  it('a CI\'s profile: no project runs on it, its values stay out of the sessions, it shows the CIs that take it', async () => {
    const profiles = make(undefined, { ci: () => [{ project: 'ABC', remote: 'origin' }] })
    const id = await profiles.save({ kind: 'cifake', name: '', values: { CIFAKE_URL: 'https://ci.example.com', CIFAKE_TOKEN: 'abc' } })
    expect(profiles.current().profiles[0]).toMatchObject({ id, kind: 'cifake', isDefault: true, login: 'abc-user' })
    expect(sessionEnv()).toEqual({ OTHER: 'x' })
    expect(profiles.view().profiles[0]).toMatchObject({ projects: [], ci: [{ project: 'ABC', remote: 'origin' }] })
    expect(await codeOf(profiles.projects(id, ''))).toBe('profiles.unknownKind')
    expect(() => profiles.link(ABC, id)).toThrow(NoticeError)
    profiles.remove(id)
    expect(profiles.current().profiles).toEqual([])
  })
})
