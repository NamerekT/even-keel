import { describe, expect, it } from 'vitest'
import { ADAPTERS } from '../tracker/adapters.js'
import { keyPool, profileFor, sameAccount, type ProfileSet, type TrackerProfile } from './model.js'

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
