import { describe, expect, it } from 'vitest'
import { remoteChoices } from './remoteProfiles.js'

const profile = (id: string, kind: string, url?: string) => ({
  id,
  kind,
  fields: url === undefined ? [] : [{ name: 'FORGEJO_URL', secret: false, set: true, value: url }],
})

const personal = profile('personal', 'github')
const org = profile('org', 'github')
const own = profile('own', 'forgejo', 'https://GIT.example.com/')
const bare = profile('bare', 'forgejo', 'git.example.com')
const elsewhere = profile('elsewhere', 'forgejo', 'https://forgejo.example.org')
const huly = profile('huly', 'huly')
const ALL = [huly, personal, org, own, bare, elsewhere]

describe('remoteChoices', () => {
  it('offers GitLab profiles only on the remote host, defaulting an empty address to GitLab.com', () => {
    const lab = (id: string, url: string) => ({ id, kind: 'gitlab', fields: [{ name: 'GITLAB_URL', secret: false, set: true, value: url }] })
    const profiles = [...ALL, lab('public', ''), lab('own-lab', 'https://GIT.example.com/lab')]
    const choices = remoteChoices(profiles, [{ id: 'git.example.com/group/app', path: 'group/app' }])
    expect(choices.gitlab.map((each) => each.id)).toEqual(['own-lab'])
    expect(choices.forgejo).toEqual([])
    expect(remoteChoices(profiles, [{ id: 'gitlab.com/group/app', path: 'group/app' }]).gitlab.map((each) => each.id)).toEqual(['public'])
  })
  it('offers the GitHub profiles to a project with a github.com remote', () => {
    expect(remoteChoices(ALL, [{ id: 'github.com/octo-org/abc', path: 'octo-org/abc' }]).github.map((each) => each.id)).toEqual(['personal', 'org'])
  })

  it('offers no GitHub profile without a github.com remote', () => {
    expect(remoteChoices(ALL, [{ id: 'git.example.com/team/abc', path: 'team/abc' }]).github).toEqual([])
  })

  it('offers the Forgejo profiles on the hosts of the project\'s other remotes', () => {
    const remotes = [
      { id: 'git.example.com/team/abc', path: 'team/abc' },
      { id: 'github.com/octo-org/abc', path: 'octo-org/abc' },
    ]
    expect(remoteChoices(ALL, remotes).forgejo.map((each) => each.id)).toEqual(['own', 'bare'])
  })

  it('offers nothing to a project with only a local remote', () => {
    expect(remoteChoices(ALL, [{ id: 'd:/repos/abc.git', path: 'abc' }])).toEqual({ github: [], forgejo: [], gitlab: [] })
  })
})
