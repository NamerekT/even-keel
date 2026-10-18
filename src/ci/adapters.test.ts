import { describe, expect, it } from 'vitest'
import type { ProfileSet, TrackerProfile } from '../profiles/model.js'
import { ciToken } from './adapters.js'

const ABC = '11111111-1111-4111-8111-111111111111'

const profile = (id: string, kind: string, isDefault: boolean, values: Record<string, string>): TrackerProfile => ({
  id,
  kind,
  name: id,
  values,
  isDefault,
  login: null,
  expiresAt: null,
})

const huly = profile('huly', 'huly', true, { HULY_URL: 'https://huly.example.com', HULY_TOKEN: 'h' })
const personal = profile('personal', 'github', true, { GITHUB_TOKEN: 'personal-token' })
const org = profile('org', 'github', false, { GITHUB_TOKEN: 'org-token' })

describe('ciToken', () => {
  it('gives GitHub Actions the token of the project\'s tracker profile when that is a GitHub one', () => {
    const set: ProfileSet = { profiles: [personal, org], links: { [ABC]: 'org' } }
    expect(ciToken('github', set, ABC, 'github', {})).toEqual({ token: 'org-token', profile: 'org' })
  })

  it('gives the default GitHub profile to a project of another tracker', () => {
    const set: ProfileSet = { profiles: [huly, org, personal], links: {} }
    expect(ciToken('github', set, ABC, 'huly', {})).toEqual({ token: 'personal-token', profile: 'personal' })
  })

  it('gives nothing without a GitHub profile, whatever the environment holds', () => {
    expect(ciToken('github', { profiles: [huly], links: {} }, ABC, 'huly', { GITHUB_TOKEN: 'stale' })).toBeNull()
  })

  it('gives Forgejo the token of the environment', () => {
    expect(ciToken('forgejo', { profiles: [], links: {} }, ABC, 'huly', { FORGEJO_TOKEN: 'f' })).toEqual({ token: 'f', profile: null })
    expect(ciToken('forgejo', { profiles: [], links: {} }, ABC, 'huly', {})).toBeNull()
  })
})
