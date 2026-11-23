import { describe, expect, it } from 'vitest'
import { isAbout } from '../link/protocol.js'
import type { Git } from '../git/types.js'
import { machineAbout } from './about.js'

const gitWith = (answers: Record<string, { code: number; out: string }>): Git => async (_cwd, args) => answers[args.join(' ')] ?? { code: 1, out: '' }

describe("the machine's report about itself", () => {
  it('names the versions it found, null for a CLI that is missing, and whether git can commit', async () => {
    const about = await machineAbout({
      evenKeel: '0.4.0',
      root: '/home/example/projects',
      home: '/home/example',
      git: gitWith({ '--version': { code: 0, out: 'git version 2.47.0\n' }, 'config --get user.name': { code: 0, out: 'John Doe\n' }, 'config --get user.email': { code: 0, out: 'john@example.com\n' } }),
      clis: async () => ({ claude: '2.1.303', codex: null }),
    })
    expect(isAbout(about)).toBe(true)
    expect(about).toMatchObject({ evenKeel: '0.4.0', git: '2.47.0', gitUser: true, gitName: 'John Doe', gitEmail: 'john@example.com', root: '/home/example/projects', node: process.versions.node })
    expect(about.agents).toMatchObject({ claude: '2.1.303', codex: null })
  })

  it('reports a machine without git and without an identity for commits', async () => {
    const about = await machineAbout({ evenKeel: '0.4.0', root: null, home: '/home/example', git: gitWith({}), clis: async () => ({}) })
    expect(about).toMatchObject({ git: null, gitUser: false, root: null })
    expect(about.commit).toBeUndefined()
    expect(about).not.toHaveProperty('gitName')
    expect(about).not.toHaveProperty('gitEmail')
  })

  it('names the e-mail alone when git has no user name, and a report without either is still whole', async () => {
    const about = await machineAbout({
      evenKeel: '0.4.0',
      root: null,
      home: '/home/example',
      git: gitWith({ '--version': { code: 0, out: 'git version 2.47.0\n' }, 'config --get user.email': { code: 0, out: 'john@example.com\n' } }),
      clis: async () => ({}),
    })
    expect(about).toMatchObject({ gitUser: false, gitEmail: 'john@example.com' })
    expect(about).not.toHaveProperty('gitName')
    const { gitEmail: _, ...older } = about
    expect(isAbout(older)).toBe(true)
    expect(isAbout({ ...about, gitName: 7 })).toBe(false)
  })

  it('names the commit of a checkout it runs from: on dev the version alone says little', async () => {
    const commit = 'c0ffee0000000000000000000000000000000000'
    const about = await machineAbout({ evenKeel: '0.4.0', root: null, commit, home: '/home/example', git: gitWith({}), clis: async () => ({}) })
    expect(about.commit).toBe(commit)
    expect(isAbout(about)).toBe(true)
  })

  it('says it runs in a container, so the hub\'s page gives Compose commands instead of an update in place', async () => {
    const sources = { evenKeel: '0.4.0', root: '/home/node/projects', home: '/home/node', git: gitWith({}), clis: async () => ({}) }
    expect((await machineAbout({ ...sources, container: true })).container).toBe(true)
    expect('container' in (await machineAbout({ ...sources, container: false }))).toBe(false)
  })
})
