import { describe, expect, it } from 'vitest'
import { keysOf, substitute } from '../packages/keys.js'
import { ADAPTERS, trackerKeyRules } from '../tracker/adapters.js'
import { keyPool, profileFor, sameAccount, serverProfile, type ProfileSet, type TrackerProfile } from './model.js'

const profile = (id: string, kind: string, isDefault: boolean, values: Record<string, string> = {}, login: string | null = null): TrackerProfile => ({
  id,
  kind,
  name: id,
  values,
  isDefault,
  login,
  expiresAt: null,
})

const SET: ProfileSet = {
  profiles: [
    profile('personal', 'github', true, {}, 'john-doe'),
    profile('org', 'github', false, {}, 'john-doe'),
    profile('work', 'huly', true, { HULY_URL: 'https://huly.example.com/', HULY_WORKSPACE: 'Example' }, 'John Doe'),
  ],
  links: { abc: 'org', xyz: 'work' },
}

describe('profileFor', () => {
  it('takes the project\'s own profile, else the default of its tracker', () => {
    expect(profileFor(SET, 'abc', 'github')?.id).toBe('org')
    expect(profileFor(SET, 'new', 'github')?.id).toBe('personal')
    expect(profileFor(SET, undefined, 'huly')?.id).toBe('work')
  })

  it('a link to a profile of another tracker is not taken', () => {
    expect(profileFor(SET, 'xyz', 'github')?.id).toBe('personal')
    expect(profileFor(SET, 'abc', 'linear')).toBeUndefined()
  })
})

describe('keyPool', () => {
  const set: ProfileSet = {
    profiles: [
      profile('personal', 'github', true, { GITHUB_TOKEN: 'personal-token' }),
      profile('org', 'github', false, { GITHUB_TOKEN: 'org-token' }),
      profile('work', 'huly', true, { HULY_URL: 'https://huly.example.com', HULY_TOKEN: 'h' }),
    ],
    links: { abc: 'org' },
  }
  const env = { PATH: '/bin', CONTEXT7_KEY: 'c7', GITHUB_TOKEN: 'stale', HULY_EMAIL: 'stale@example.com' }

  it('gives a project its own profile over the defaults, and no tracker variable of the environment', () => {
    expect(keyPool(set, ADAPTERS, env, 'abc', 'github')).toEqual({ PATH: '/bin', CONTEXT7_KEY: 'c7', GITHUB_TOKEN: 'org-token', HULY_URL: 'https://huly.example.com', HULY_TOKEN: 'h' })
  })

  it('gives a project of another tracker the default profiles', () => {
    expect(keyPool(set, ADAPTERS, env, 'xyz', 'huly')).toMatchObject({ GITHUB_TOKEN: 'personal-token', HULY_TOKEN: 'h' })
    expect(keyPool(set, ADAPTERS, env, 'xyz', 'huly').HULY_EMAIL).toBeUndefined()
  })

  it("gives a feed's tracker of another kind the feed's profile, the project's own kind staying the project's (BTN-66)", () => {
    const fed = { ...set, feeds: { 'feed-gh': 'org' } }
    expect(keyPool(fed, ADAPTERS, env, 'xyz', 'huly', [{ id: 'feed-gh', tracker: 'github' }])).toMatchObject({ GITHUB_TOKEN: 'org-token', HULY_TOKEN: 'h' })
    expect(keyPool(fed, ADAPTERS, env, 'xyz', 'github', [{ id: 'feed-gh', tracker: 'github' }]).GITHUB_TOKEN).toBe('personal-token')
  })

  it.each([
    { source: 'project', kind: 'gitlab', feeds: [] },
    { source: 'feed', kind: 'huly', feeds: [{ id: 'cloud-feed', tracker: 'gitlab' }] },
    { source: 'last feed', kind: 'huly', feeds: [{ id: 'local-feed', tracker: 'gitlab' }, { id: 'cloud-feed', tracker: 'gitlab' }] },
    { source: 'project over its feed', kind: 'gitlab', feeds: [{ id: 'local-feed', tracker: 'gitlab' }] },
  ])('replaces all variables of the $source profile so an omitted URL uses the server default', ({ kind, feeds }) => {
    const profiles: ProfileSet = {
      profiles: [
        ...set.profiles,
        profile('local', 'gitlab', true, { GITLAB_URL: 'https://gitlab.example.com', GITLAB_TOKEN: 'local-token' }),
        profile('cloud', 'gitlab', false, { GITLAB_TOKEN: 'cloud-token' }),
      ],
      links: { abc: 'cloud' },
      feeds: { 'local-feed': 'local', 'cloud-feed': 'cloud' },
    }
    const pool = keyPool(profiles, ADAPTERS, env, 'abc', kind, feeds)
    expect(pool).not.toHaveProperty('GITLAB_URL')
    expect(pool).toMatchObject({ GITLAB_TOKEN: 'cloud-token', GITHUB_TOKEN: 'personal-token', HULY_TOKEN: 'h', CONTEXT7_KEY: 'c7' })
    expect(serverProfile(profiles, 'abc', kind, feeds, 'gitlab')?.id).toBe('cloud')

    const entry = { command: 'npx', env: { GITLAB_API_URL: '${GITLAB_URL:-https://gitlab.com}', GITLAB_PERSONAL_ACCESS_TOKEN: '${GITLAB_PERSONAL_ACCESS_TOKEN}' } }
    const keys = keysOf('gitlab', entry, trackerKeyRules(), pool)
    expect(keys.missing).toEqual([])
    expect(keys.names).toContain('GITLAB_URL')
    expect(keys.env).not.toHaveProperty('GITLAB_URL')
    expect(substitute(entry, keys.values).env).toEqual({ GITLAB_API_URL: 'https://gitlab.com', GITLAB_PERSONAL_ACCESS_TOKEN: 'cloud-token' })
  })
})

describe('serverProfile', () => {
  const set: ProfileSet = {
    profiles: [profile('personal', 'github', true), profile('org', 'github', false), profile('work', 'huly', true)],
    links: { abc: 'org' },
    feeds: { 'feed-a': 'personal', 'feed-b': 'org' },
  }

  it("signs a server of the project's tracker in as the project's profile, whatever its feeds of that kind run on", () => {
    expect(serverProfile(set, 'abc', 'github', [{ id: 'feed-a', tracker: 'github' }], 'github')?.id).toBe('org')
  })

  it("signs a server of another tracker in as the last feed's of that kind, as keyPool does, else as the default", () => {
    const feeds = [
      { id: 'feed-b', tracker: 'github' },
      { id: 'feed-a', tracker: 'github' },
    ]
    expect(serverProfile(set, 'xyz', 'huly', feeds, 'github')?.id).toBe('personal')
    expect(serverProfile(set, 'xyz', 'huly', feeds.slice(0, 1), 'github')?.id).toBe('org')
    expect(serverProfile(set, 'xyz', 'huly', [], 'github')?.id).toBe('personal')
  })
})

describe('sameAccount', () => {
  it('finds the profile of the same tracker, host and login, other than the one edited', () => {
    expect(sameAccount(SET, ADAPTERS.github!, 'github', {}, 'john-doe', null)?.id).toBe('personal')
    expect(sameAccount(SET, ADAPTERS.github!, 'github', {}, 'john-doe', 'personal')?.id).toBe('org')
    const values = { HULY_URL: 'https://HULY.example.com', HULY_WORKSPACE: 'example' }
    expect(sameAccount(SET, ADAPTERS.huly!, 'huly', values, 'John Doe', null)?.id).toBe('work')
    expect(sameAccount(SET, ADAPTERS.huly!, 'huly', { ...values, HULY_WORKSPACE: 'other' }, 'John Doe', null)).toBeUndefined()
  })
})
