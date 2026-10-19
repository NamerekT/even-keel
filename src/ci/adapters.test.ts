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
const GITHUB = { kind: 'github', web: 'https://github.com' } as const
const FORGEJO = { kind: 'forgejo', web: 'https://git.example.com' } as const

const forgejo = (id: string, isDefault: boolean, url: string) => profile(id, 'forgejo', isDefault, { FORGEJO_URL: url, FORGEJO_TOKEN: `${id}-token` })

describe('ciToken', () => {
  it('gives GitHub Actions the token of the project\'s tracker profile when that is a GitHub one', () => {
    const set: ProfileSet = { profiles: [personal, org], links: { [ABC]: 'org' } }
    expect(ciToken(GITHUB, set, ABC, 'github')).toEqual({ token: 'org-token', profile: 'org' })
  })

  it('gives the default GitHub profile to a project of another tracker', () => {
    const set: ProfileSet = { profiles: [huly, org, personal], links: {} }
    expect(ciToken(GITHUB, set, ABC, 'huly')).toEqual({ token: 'personal-token', profile: 'personal' })
  })

  it('gives nothing without a GitHub profile', () => {
    expect(ciToken(GITHUB, { profiles: [huly], links: {} }, ABC, 'huly')).toBeNull()
  })

  it('gives Forgejo the token of the Forgejo profile on the remote\'s host, whatever the default', () => {
    const set: ProfileSet = { profiles: [forgejo('other', true, 'https://forgejo.example.org'), forgejo('own', false, 'https://GIT.example.com/')], links: {} }
    expect(ciToken(FORGEJO, set, ABC, 'huly')).toEqual({ token: 'own-token', profile: 'own' })
    expect(ciToken({ kind: 'forgejo', web: 'https://git.example.com/sub' }, set, ABC, 'huly')?.profile).toBe('own')
  })

  it('takes the default Forgejo profile among several on the host, else the first of them', () => {
    const first = forgejo('first', false, 'https://git.example.com')
    const second = forgejo('second', true, 'git.example.com')
    expect(ciToken(FORGEJO, { profiles: [first, second], links: {} }, ABC, 'huly')?.profile).toBe('second')
    const third = forgejo('third', false, 'https://git.example.com:3000')
    expect(ciToken(FORGEJO, { profiles: [first, third, forgejo('elsewhere', true, 'https://forgejo.example.org')], links: {} }, ABC, 'huly')?.profile).toBe('first')
  })

  it('gives Forgejo nothing without a profile on the remote\'s host', () => {
    const set: ProfileSet = { profiles: [huly, forgejo('other', true, 'https://forgejo.example.org')], links: {} }
    expect(ciToken(FORGEJO, set, ABC, 'huly')).toBeNull()
  })

  it('takes the profile the project chose for the remote\'s kind over the tracker\'s and the default (BTN-231)', () => {
    const set: ProfileSet = { profiles: [personal, org], links: { [ABC]: 'personal' } }
    expect(ciToken(GITHUB, set, ABC, 'github', { github: 'org' })).toEqual({ token: 'org-token', profile: 'org' })
    expect(ciToken(GITHUB, { profiles: [huly, personal, org], links: {} }, ABC, 'huly', { github: 'org' })?.profile).toBe('org')
  })

  it('takes the chosen Forgejo profile only on the remote\'s host', () => {
    const own = forgejo('own', true, 'https://git.example.com')
    const second = forgejo('second', false, 'https://git.example.com')
    const elsewhere = forgejo('elsewhere', false, 'https://forgejo.example.org')
    const set: ProfileSet = { profiles: [own, second, elsewhere], links: {} }
    expect(ciToken(FORGEJO, set, ABC, 'huly', { forgejo: 'second' })?.profile).toBe('second')
    expect(ciToken(FORGEJO, set, ABC, 'huly', { forgejo: 'elsewhere' })?.profile).toBe('own')
  })

  it('falls back as without a choice when the chosen profile is gone or of another kind', () => {
    const set: ProfileSet = { profiles: [huly, personal, org], links: {} }
    expect(ciToken(GITHUB, set, ABC, 'huly', { github: 'deleted' })?.profile).toBe('personal')
    expect(ciToken(GITHUB, set, ABC, 'huly', { github: 'huly' })?.profile).toBe('personal')
    expect(ciToken(GITHUB, set, ABC, 'huly', { forgejo: 'org' })?.profile).toBe('personal')
  })
})
