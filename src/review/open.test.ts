import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GitResult } from '../git/types.js'
import type { Forge } from './model.js'
import { describedBy, openPull, pullTarget } from './open.js'

describe('openPull', () => {
  const now = () => new Date('2026-10-19T12:00:00Z')

  /** `status` — what `git status` lists; `note` — whether the session wrote the pull request's note. */
  async function opening(ahead: GitResult, status = '', note = true) {
    const dir = await mkdtemp(join(tmpdir(), 'open-pull-'))
    if (note) await writeFile(join(dir, 'pull.md'), 'Fix the parser\n')
    const asked: string[] = []
    const git = async (_cwd: string, args: string[]): Promise<GitResult> => {
      asked.push(args.join(' '))
      if (args[0] === 'symbolic-ref') return { code: 0, out: 'abc-7/task\n' }
      if (args[0] === 'rev-list') return ahead
      if (args[0] === 'status') return { code: 0, out: status }
      return { code: 0, out: '' }
    }
    const created: string[] = []
    const forge: Forge = {
      kind: 'github',
      find: async () => null,
      create: async ({ branch }) => {
        created.push(branch)
        return { number: 3, url: 'https://github.com/john/abc/pull/3' }
      },
      state: async () => ({ state: 'open', mergeable: true, head: 'a1' }),
      changes: async () => [],
    }
    const result = openPull(git, dir, 'pull.md', 'origin', forge, 'trunk', now)
    return { result, asked, created }
  }

  it('opens nothing for a branch with no commits beyond the remote base and a clean worktree, note or not, and pushes nothing', async () => {
    for (const note of [true, false]) {
      const { result, asked, created } = await opening({ code: 0, out: '0\n' }, '?? pull.md\n', note)
      await expect(result).resolves.toBeNull()
      expect(asked).toContain('fetch --quiet origin trunk')
      expect(asked).toContain('rev-list --count refs/remotes/origin/trunk..HEAD')
      expect(asked.some((each) => each.startsWith('push'))).toBe(false)
      expect(created).toEqual([])
    }
  })

  it('refuses a branch with no commits beyond the base whose work is not committed, new files included', async () => {
    for (const status of [' M src/parser.ts\n', '?? src/quotes.ts\n']) {
      const { result, asked, created } = await opening({ code: 0, out: '0\n' }, status)
      await expect(result).rejects.toMatchObject({ notice: { code: 'review.nothingAhead', params: { branch: 'abc-7/task', base: 'trunk' } } })
      expect(asked.some((each) => each.startsWith('push'))).toBe(false)
      expect(created).toEqual([])
    }
  })

  it('pushes and opens a branch ahead of the base, and leaves the judgement to the forge when git cannot count', async () => {
    for (const ahead of [{ code: 0, out: '2\n' }, { code: 128, out: 'fatal: bad revision' }]) {
      const { result, created } = await opening(ahead)
      await expect(result).resolves.toMatchObject({ number: 3, branch: 'abc-7/task' })
      expect(created).toEqual(['abc-7/task'])
    }
  })
})

describe('pullTarget', () => {
  it('takes origin when its address parses', () => {
    const remotes = [
      { name: 'github', url: 'git@github.com:acme/app.git' },
      { name: 'origin', url: 'https://git.example.com/acme/app.git' },
    ]
    expect(pullTarget(remotes)).toEqual({ kind: 'forgejo', remote: 'origin', web: 'https://git.example.com', owner: 'acme', repo: 'app' })
  })

  it('falls back to the first remote that parses, GitHub by its host', () => {
    const remotes = [
      { name: 'origin', url: 'D:/backup/app.git' },
      { name: 'hub', url: 'git@github.com:acme/app.git' },
    ]
    expect(pullTarget(remotes)).toEqual({ kind: 'github', remote: 'hub', web: 'https://github.com', owner: 'acme', repo: 'app' })
  })

  it('finds none without a remote on a forge', () => {
    expect(pullTarget([{ name: 'origin', url: 'D:/backup/app.git' }])).toBeNull()
    expect(pullTarget([])).toBeNull()
  })
})

describe('describedBy', () => {
  it('takes the first line for the title and the rest for the body', () => {
    expect(describedBy('# [ABC-7] Fix the parser\n\nThe parser now keeps quotes.\n- tests added\n')).toEqual({
      title: '[ABC-7] Fix the parser',
      body: 'The parser now keeps quotes.\n- tests added',
    })
  })

  it('skips blank lines before the title', () => {
    expect(describedBy('\n\nFix it')).toEqual({ title: 'Fix it', body: '' })
  })

  it('gives nothing for an empty note', () => {
    expect(describedBy(' \n\n')).toBeNull()
  })
})
