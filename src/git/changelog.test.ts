import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { noticeOf } from '../notice/notice.js'
import { commitChangelog, type ChangelogCommit } from './changelog.js'
import { runGit } from './run.js'

let repo: string

const git = async (...args: string[]) => {
  const result = await runGit(repo, args)
  if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.out}`)
  return result.out
}

const request = (fields: Partial<ChangelogCommit> = {}): ChangelogCommit => ({
  branch: 'main',
  path: 'docs/CHANGELOG.md',
  message: 'Changelog of v0.1',
  change: (text) => `${text ?? '# Changelog\n'}\n## [Unreleased]\n`,
  ...fields,
})

const refusal = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => noticeOf(error).code)

describe('commitChangelog', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'even-keel-changelog-'))
    await git('init', '-q', '--template=', '-b', 'main')
    await git('config', 'user.email', 'john.doe@example.com')
    await git('config', 'user.name', 'John Doe')
    await git('config', 'core.hooksPath', join(repo, 'no-hooks'))
    await git('config', 'core.autocrlf', 'false')
    writeFileSync(join(repo, 'README.md'), 'readme')
    await git('add', 'README.md')
    await git('commit', '-q', '-m', 'base')
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('creates the file and commits it alone, leaving other changes as they are', async () => {
    writeFileSync(join(repo, 'README.md'), 'changed')
    await git('add', 'README.md')
    const sha = await commitChangelog(runGit, repo, request())
    expect(sha).toBe(await git('rev-parse', 'HEAD'))
    expect(await git('show', '--name-only', '--format=%s', 'HEAD')).toBe('Changelog of v0.1\n\ndocs/CHANGELOG.md')
    expect(readFileSync(join(repo, 'docs', 'CHANGELOG.md'), 'utf8')).toBe('# Changelog\n\n## [Unreleased]\n')
    expect(await git('status', '--porcelain')).toBe('M  README.md')
  })

  it('keeps the CRLF line ends of the file and gives the change LF ones', async () => {
    writeFileSync(join(repo, 'CHANGELOG.md'), '# Changelog\r\n\r\nIntro\r\n')
    await git('add', 'CHANGELOG.md')
    await git('commit', '-q', '-m', 'changelog')
    let seen: string | null = null
    await commitChangelog(runGit, repo, request({ path: 'CHANGELOG.md', change: (text) => ((seen = text), `${text}\n## [Unreleased]\n`) }))
    expect(seen).toBe('# Changelog\n\nIntro\n')
    expect(readFileSync(join(repo, 'CHANGELOG.md'), 'utf8')).toBe('# Changelog\r\n\r\nIntro\r\n\r\n## [Unreleased]\r\n')
  })

  it('commits nothing when the text does not change', async () => {
    const head = await git('rev-parse', 'HEAD')
    expect(await commitChangelog(runGit, repo, request({ path: 'README.md', change: (text) => text ?? '' }))).toBeNull()
    expect(await git('rev-parse', 'HEAD')).toBe(head)
  })

  it('refuses another branch and a file with changes of its own', async () => {
    expect(await refusal(commitChangelog(runGit, repo, request({ branch: 'trunk' })))).toBe('changelog.notOnBranch')
    writeFileSync(join(repo, 'README.md'), 'by hand')
    expect(await refusal(commitChangelog(runGit, repo, request({ path: 'README.md' })))).toBe('changelog.dirty')
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('by hand')
  })

  it('puts the file back when the commit is refused', async () => {
    await git('config', 'core.hooksPath', join(repo, 'hooks'))
    mkdirSync(join(repo, 'hooks'))
    writeFileSync(join(repo, 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    expect(await refusal(commitChangelog(runGit, repo, request({ path: 'README.md' })))).toBe('changelog.commitFailed')
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('readme')
    expect(await git('status', '--porcelain', '--', 'README.md')).toBe('')
  })
})
