import { describe, expect, it } from 'vitest'
import type { ProfileSet } from '../profiles/model.js'
import { folderGitCredentials, hubGitCredentials, projectOfFolder } from './git-credentials.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const URL = 'https://github.com/john/repo.git'

const set: ProfileSet = {
  profiles: [{ id: 'personal', kind: 'github', name: 'John GitHub', values: { GITHUB_TOKEN: 'ghp_example' }, isDefault: true, login: null, expiresAt: null }],
  links: {},
}

/** The hub's reads: `rows` — the (project, machine) pairs of `project_machines`, turned on or off. */
const hub = (rows: [string, string][]) => ({
  db: {
    query: async (_sql: string, [project, machine]: unknown[]) => ({ rows: rows.filter(([p, m]) => p === project && m === machine).map(() => ({ '?column?': 1 })) }),
  },
  profiles: { current: () => set },
  configStore: { current: { projects: { [ABC]: '/repos/abc' }, trackers: { [ABC]: 'huly' }, settings: {} } },
}) as unknown as Parameters<typeof hubGitCredentials>[0]

describe('hubGitCredentials', () => {
  it('answers a machine with a folder of the project, turned on or off', async () => {
    const answer = await hubGitCredentials(hub([[ABC, 'm1']]), () => {})('m1', ABC, [URL])
    expect(answer.credentials).toEqual([{ url: URL, username: 'x-access-token', password: 'ghp_example', profile: { id: 'personal', name: 'John GitHub' } }])
  })

  it('refuses a machine with no folder of the project, unless the hub is cloning it there', async () => {
    const log: string[] = []
    const answer = hubGitCredentials(hub([[ABC, 'm1']]), (line) => log.push(line))
    expect(await answer('m2', ABC, [URL])).toEqual({ credentials: [] })
    expect(log).toEqual([`link: machine m2 asked git credentials of ${ABC}, a project it has no folder of and is not cloning: refused`])
    expect((await answer('m2', ABC, [URL], true)).credentials).toHaveLength(1)
  })
})

describe('folderGitCredentials', () => {
  it('gives a project’s worktree its tokens and a folder of no project none', async () => {
    const of = folderGitCredentials(hub([]))
    expect(await of('/repos/abc/.claude/worktrees/abc-1', [URL])).toHaveLength(1)
    expect(await of('/repos/other', [URL])).toEqual([])
  })

  it('finds the project of a folder by its checkout first', () => {
    expect(projectOfFolder({ a: '/repos/abc', b: '/repos/abc/inner' }, '/repos/abc/inner')).toBe('b')
    expect(projectOfFolder({ a: '/repos/abc' }, '/elsewhere')).toBeUndefined()
  })
})
