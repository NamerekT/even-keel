import { describe, expect, it } from 'vitest'
import type { ProfileSet, TrackerProfile } from '../profiles/model.js'
import { gitCredentials, gitUser } from './git-credentials.js'

const ABC = '11111111-1111-4111-8111-111111111111'

const profile = (id: string, kind: string, isDefault: boolean, values: Record<string, string>, login: string | null = null): TrackerProfile => ({
  id,
  kind,
  name: `${id} profile`,
  values,
  isDefault,
  login,
  expiresAt: null,
})

const personal = profile('personal', 'github', true, { GITHUB_TOKEN: 'personal-token' })
const org = profile('org', 'github', false, { GITHUB_TOKEN: 'org-token' })
const forge = profile('forge', 'forgejo', true, { FORGEJO_URL: 'https://git.example.com', FORGEJO_TOKEN: 'forge-token' }, 'john')
const lab = profile('lab', 'gitlab', true, { GITLAB_URL: 'https://lab.example.com/gitlab', GITLAB_TOKEN: 'lab-token' })

describe('gitUser', () => {
  it('names the user each forge takes a token under', () => {
    expect(gitUser('github', 'john')).toBe('x-access-token')
    expect(gitUser('gitlab', 'john')).toBe('oauth2')
    expect(gitUser('forgejo', 'john')).toBe('john')
    expect(gitUser('forgejo', null)).toBe('even-keel')
  })
})

describe('gitCredentials', () => {
  const set: ProfileSet = { profiles: [personal, org, forge, lab], links: {} }

  it('gives each HTTPS remote the token its CI would take, under the forge\'s user', () => {
    const urls = ['https://github.com/john/repo.git', 'https://git.example.com/john/repo.git', 'https://lab.example.com/gitlab/group/sub/repo.git']
    expect(gitCredentials(urls, set)).toEqual([
      { url: urls[0], username: 'x-access-token', password: 'personal-token', profile: { id: 'personal', name: 'personal profile' } },
      { url: urls[1], username: 'john', password: 'forge-token', profile: { id: 'forge', name: 'forge profile' } },
      { url: urls[2], username: 'oauth2', password: 'lab-token', profile: { id: 'lab', name: 'lab profile' } },
    ])
  })

  it('takes the profile the project chose for the forge over the default', () => {
    const [credential] = gitCredentials(['https://github.com/acme/repo.git'], set, { project: ABC, tracker: 'huly', chosen: { github: 'org' } })
    expect(credential?.password).toBe('org-token')
  })

  it('gives nothing for a host no profile is on, a forge without an adapter or a turned-off profile', () => {
    expect(gitCredentials(['https://other.example.com/john/repo.git', 'https://bitbucket.org/john/repo.git'], set)).toEqual([])
    const off: ProfileSet = { profiles: [{ ...personal, disabled: true }], links: {} }
    expect(gitCredentials(['https://github.com/john/repo.git'], off)).toEqual([])
  })
})
