import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CiTarget } from '../ci/remote.js'
import type { GitResult } from '../git/types.js'
import type { Forge } from './model.js'
import { notice } from '../notice/notice.js'
import { closingBody, closingOf, describedBy, openPull, pullReadiness, pullTarget } from './open.js'

describe('openPull', () => {
  const now = () => new Date('2026-10-19T12:00:00Z')

  /** `status` — what `git status` lists; `note` — whether the session wrote the pull request's note. */
  async function opening(ahead: GitResult, status = '', note = true, closes?: { issue: string; repo: string }) {
    const dir = await mkdtemp(join(tmpdir(), 'open-pull-'))
    if (note) await writeFile(join(dir, 'pull.md'), 'Fix the parser\n\nQuotes kept.\n')
    const asked: string[] = []
    const git = async (_cwd: string, args: string[]): Promise<GitResult> => {
      asked.push(args.join(' '))
      if (args[0] === 'symbolic-ref') return { code: 0, out: 'abc-7/task\n' }
      if (args[0] === 'rev-list') return ahead
      if (args[0] === 'status') return { code: 0, out: status }
      return { code: 0, out: '' }
    }
    const created: string[] = []
    const bodies: string[] = []
    const forge: Forge = {
      kind: 'github',
      find: async () => null,
      create: async ({ branch, body }) => {
        created.push(branch)
        bodies.push(body)
        return { number: 3, url: 'https://github.com/john/abc/pull/3' }
      },
      state: async () => ({ state: 'open', mergeable: true, head: 'a1' }),
      changes: async () => [],
    }
    const result = openPull(git, dir, 'pull.md', 'origin', forge, 'trunk', now, closes)
    return { result, asked, created, bodies }
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

  it('opens the pull request with the session’s body, and a closing line for the issue when there is one', async () => {
    const plain = await opening({ code: 0, out: '1\n' })
    await plain.result
    expect(plain.bodies).toEqual(['Quotes kept.'])
    const closing = await opening({ code: 0, out: '1\n' }, '', true, { issue: 'john/abc#7', repo: 'john/abc' })
    await closing.result
    expect(closing.bodies).toEqual(['Quotes kept.\n\nCloses john/abc#7'])
  })
})

describe('pullTarget', () => {
  it('takes GitLab by gitlab.com or a GitLab profile’s host, with the subgroups in the owner', () => {
    expect(pullTarget([{ name: 'origin', url: 'git@gitlab.com:group/sub/app.git' }])).toEqual({ kind: 'gitlab', remote: 'origin', web: 'https://gitlab.com', owner: 'group/sub', repo: 'app' })
    expect(pullTarget([{ name: 'origin', url: 'https://git.example.com/gitlab/group/app.git' }], ['https://git.example.com/gitlab'])).toEqual({
      kind: 'gitlab',
      remote: 'origin',
      web: 'https://git.example.com/gitlab',
      owner: 'group',
      repo: 'app',
    })
    expect(pullTarget([{ name: 'origin', url: 'git@git.example.com:group/app.git' }])).toMatchObject({ kind: 'forgejo' })
  })

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

  it('names the host of a remote on a forge it has no adapter for', () => {
    expect(pullTarget([{ name: 'origin', url: 'git@bitbucket.org:acme/app.git' }])).toEqual({ kind: null, remote: 'origin', host: 'bitbucket.org' })
  })

  it('finds none without a remote on a forge', () => {
    expect(pullTarget([{ name: 'origin', url: 'D:/backup/app.git' }])).toBeNull()
    expect(pullTarget([])).toBeNull()
  })
})

describe('pullReadiness', () => {
  const remotes = [{ name: 'origin', url: 'git@github.com:acme/app.git' }]

  it('gives the target and its token', () => {
    expect(pullReadiness('ABC', remotes, () => 'secret')).toEqual({
      target: { kind: 'github', remote: 'origin', web: 'https://github.com', owner: 'acme', repo: 'app' },
      token: 'secret',
    })
  })

  it('names the missing remote', () => {
    expect(pullReadiness('ABC', [{ name: 'origin', url: 'D:/backup/app.git' }], () => 'secret')).toEqual({
      notice: notice('review.noRemote', { project: 'ABC' }),
    })
  })

  it('names the remote no profile has a token for, with the kind and the address a new profile takes', () => {
    expect(pullReadiness('ABC', remotes, () => null)).toEqual({ notice: notice('review.noToken', { remote: 'origin', kind: 'github', web: 'https://github.com' }) })
    const forgejo = [{ name: 'origin', url: 'ssh://git@git.example.com:2222/acme/app.git' }]
    expect(pullReadiness('ABC', forgejo, () => null)).toEqual({
      notice: notice('review.noToken', { remote: 'origin', kind: 'forgejo', web: 'https://git.example.com' }),
    })
  })

  it('says a remote on an unsupported host is not supported, without asking for a token', () => {
    let asked = false
    const ready = pullReadiness('ABC', [{ name: 'origin', url: 'https://bitbucket.org/acme/app.git' }], () => {
      asked = true
      return 'secret'
    })
    expect(ready).toEqual({ notice: notice('review.unsupportedHost', { remote: 'origin', host: 'bitbucket.org' }) })
    expect(asked).toBe(false)
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

describe('closingBody', () => {
  it('adds a closing line for the issue at the end of the body', () => {
    expect(closingBody('The parser now keeps quotes.', 'octo-org/abc#7', 'octo-org/abc')).toBe('The parser now keeps quotes.\n\nCloses octo-org/abc#7')
    expect(closingBody('', 'octo-org/tasks#7', 'octo-org/abc')).toBe('Closes octo-org/tasks#7')
  })

  it('adds nothing when the body already closes the issue, by its full name, its address or its number in the same repository', () => {
    for (const body of ['Fixes octo-org/ABC#7.', 'resolved: https://github.com/octo-org/abc/issues/7', 'Quotes kept.\n\nCloses #7']) {
      expect(closingBody(body, 'octo-org/abc#7', 'octo-org/abc')).toBe(body)
    }
  })

  it('adds the line when the body only mentions the issue or closes another one', () => {
    for (const body of ['See octo-org/abc#7', 'Closes octo-org/abc#70', 'Closes #7']) {
      expect(closingBody(body, 'octo-org/tasks#7', 'octo-org/abc')).toBe(`${body}\n\nCloses octo-org/tasks#7`)
    }
    expect(closingBody('See #7', 'octo-org/abc#7', 'octo-org/abc')).toBe('See #7\n\nCloses octo-org/abc#7')
  })

  it('closes an issue of the merge request’s own GitLab project by its number, another project’s by its full name', () => {
    const gitlab = 'https://git.example.com/gitlab'
    expect(closingBody('Quotes kept.', 'group/app#7', 'group/app', gitlab)).toBe('Quotes kept.\n\nCloses #7')
    expect(closingBody('', 'group/sub/tasks#7', 'group/app', gitlab)).toBe('Closes group/sub/tasks#7')
    for (const body of ['Closes #7', 'Fixes group/sub/tasks#7', `resolves ${gitlab}/group/sub/tasks/-/issues/7`]) {
      const issue = body === 'Closes #7' ? 'group/app#7' : 'group/sub/tasks#7'
      expect(closingBody(body, issue, 'group/app', gitlab)).toBe(body)
    }
  })
})

describe('closingOf', () => {
  const github: CiTarget = { kind: 'github', remote: 'origin', web: 'https://github.com', owner: 'octo-org', repo: 'abc' }
  const gitlab: CiTarget = { kind: 'gitlab', remote: 'origin', web: 'https://git.example.com/gitlab', owner: 'group', repo: 'app' }

  it('takes a GitHub issue for a pull request on GitHub', () => {
    expect(closingOf(github, 'octo-org/tasks#7')).toEqual({ issue: 'octo-org/tasks#7', repo: 'octo-org/abc' })
    expect(closingOf(github, 'https://git.example.com/gitlab/group/app/-/issues/7')).toBeNull()
  })

  it('takes a GitLab issue on the merge request’s own server by its address', () => {
    expect(closingOf(gitlab, 'https://git.example.com/gitlab/group/sub/tasks/-/issues/7')).toEqual({ issue: 'group/sub/tasks#7', repo: 'group/app', gitlab: 'https://git.example.com/gitlab' })
    expect(closingOf(gitlab, 'https://gitlab.com/group/app/-/issues/7')).toBeNull()
    expect(closingOf(gitlab, 'group/app#7')).toBeNull()
  })

  it('closes nothing on Forgejo', () => {
    expect(closingOf({ ...github, kind: 'forgejo', web: 'https://git.example.com' }, 'octo-org/tasks#7')).toBeNull()
  })
})
