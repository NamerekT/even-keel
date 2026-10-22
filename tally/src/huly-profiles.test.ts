import { describe, expect, it } from 'vitest'
import { byCredentials, hulyOfProfiles } from './huly-profiles.js'

const work = { HULY_URL: 'https://huly.example.com', HULY_WORKSPACE: 'work', HULY_TOKEN: 'w' }
const home = { HULY_URL: 'https://huly.example.com', HULY_WORKSPACE: 'home', HULY_EMAIL: 'john@example.com', HULY_PASSWORD: 'p' }

describe('hulyOfProfiles', () => {
  it('gives a task the profile of its project, and the default profile to a project the service does not name', () => {
    const hulyOf = hulyOfProfiles({ projects: { ABC: work, XY2: home }, fallback: work })
    expect(hulyOf('ABC-12')).toMatchObject({ workspace: 'work', token: 'w' })
    expect(hulyOf('XY2-3')).toMatchObject({ workspace: 'home', email: 'john@example.com' })
    expect(hulyOf('OLD-1')).toMatchObject({ workspace: 'work' })
  })

  it("gives nothing to a task of another tracker's project or feed, not even the default profile", () => {
    const hulyOf = hulyOfProfiles({ projects: { ABC: work }, fallback: work, elsewhere: ['ABCGH', 'WEB'] })
    expect(hulyOf('ABCGH-4')).toBeUndefined()
    expect(hulyOf('WEB-7')).toBeUndefined()
    expect(hulyOf('ABC-1')).toMatchObject({ workspace: 'work' })
  })

  it('gives nothing without a profile, or with one Huly would not take', () => {
    expect(hulyOfProfiles({ projects: {}, fallback: null })('ABC-1')).toBeUndefined()
    expect(hulyOfProfiles({ projects: { ABC: { HULY_URL: 'https://huly.example.com' } }, fallback: null })('ABC-1')).toBeUndefined()
  })
})

describe('byCredentials', () => {
  it('groups the tasks by the credentials that reach them and leaves out those none reaches', () => {
    const hulyOf = hulyOfProfiles({ projects: { ABC: work, XYZ: home, DEF: work }, fallback: null })
    const groups = byCredentials(['ABC-1', 'XYZ-2', 'DEF-3', 'OLD-4'], (task) => task, hulyOf)
    expect(groups.map((group) => [group.credentials.workspace, group.items])).toEqual([
      ['work', ['ABC-1', 'DEF-3']],
      ['home', ['XYZ-2']],
    ])
  })
})
