import { describe, expect, it } from 'vitest'
import { gitArgs } from './run.js'

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
