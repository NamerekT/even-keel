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
      version: async (binary) => (binary === 'claude' ? '2.1.303 (Claude Code)\n' : null),
    })
    expect(isAbout(about)).toBe(true)
    expect(about).toMatchObject({ evenKeel: '0.4.0', git: '2.47.0', gitUser: true, root: '/home/example/projects', node: process.versions.node })
    expect(about.agents).toMatchObject({ claude: '2.1.303', codex: null })
  })

  it('reports a machine without git and without an identity for commits', async () => {
    const about = await machineAbout({ evenKeel: '0.4.0', root: null, home: '/home/example', git: gitWith({}), version: async () => null })
    expect(about).toMatchObject({ git: null, gitUser: false, root: null })
  })
})
