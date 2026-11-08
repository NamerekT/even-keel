import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { gitArgs, gitMissing, runGit } from './run.js'

describe('gitMissing', () => {
  const stub = 'xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun at: /Library/Developer/CommandLineTools/usr/bin/xcrun'

  it.each(['win32', 'darwin', 'linux'] as const)('recognises ENOENT on %s', (platform) => {
    expect(gitMissing('ENOENT', '', platform)).toBe(true)
  })

  it('recognises the macOS git stub only on a failed exit on macOS', () => {
    expect(gitMissing(1, stub, 'darwin')).toBe(true)
    expect(gitMissing(0, stub, 'darwin')).toBe(false)
    expect(gitMissing(undefined, stub, 'darwin')).toBe(false)
    expect(gitMissing(null, stub, 'darwin')).toBe(false)
    expect(gitMissing(1, stub, 'linux')).toBe(false)
    expect(gitMissing(1, stub, 'win32')).toBe(false)
  })

  it('keeps license failures, ordinary git errors and empty output as command failures', () => {
    expect(gitMissing(69, 'You have not agreed to the Xcode license agreements', 'darwin')).toBe(false)
    expect(gitMissing(128, 'fatal: not a git repository', 'darwin')).toBe(false)
    expect(gitMissing(1, '', 'darwin')).toBe(false)
  })
})

describe('runGit', () => {
  const path = process.env.PATH
  afterEach(() => {
    process.env.PATH = path
  })

  it('says git that does not start as missing, not as a failed command (BTN-731)', async () => {
    process.env.PATH = ''
    expect(await runGit(tmpdir(), ['--version'])).toMatchObject({ code: -1, missing: true })
  })
})

describe('gitArgs', () => {
  it('turns on long paths on Windows, where git stops at MAX_PATH without it', () => {
    expect(gitArgs('D:/repo', ['worktree', 'remove', 'x'], 'win32')).toEqual(['--no-optional-locks', '-c', 'core.longpaths=true', '-C', 'D:/repo', 'worktree', 'remove', 'x'])
  })

  it('adds nothing but the optional locks elsewhere', () => {
    expect(gitArgs('/repo', ['status'], 'linux')).toEqual(['--no-optional-locks', '-C', '/repo', 'status'])
    expect(gitArgs('/repo', ['status'], 'darwin')).toEqual(['--no-optional-locks', '-C', '/repo', 'status'])
  })

  it('never takes the index lock for a read, so a session committing in the same worktree meanwhile is not refused', () => {
    expect(gitArgs('/repo', ['status', '--porcelain'], 'linux')[0]).toBe('--no-optional-locks')
  })
})
