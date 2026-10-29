import { describe, expect, it } from 'vitest'
import { gitArgs } from './run.js'

describe('gitArgs', () => {
  it('turns on long paths on Windows, where git stops at MAX_PATH without it', () => {
    expect(gitArgs('D:/repo', ['worktree', 'remove', 'x'], 'win32')).toEqual(['-c', 'core.longpaths=true', '-C', 'D:/repo', 'worktree', 'remove', 'x'])
  })

  it('leaves the arguments alone elsewhere', () => {
    expect(gitArgs('/repo', ['status'], 'linux')).toEqual(['-C', '/repo', 'status'])
    expect(gitArgs('/repo', ['status'], 'darwin')).toEqual(['-C', '/repo', 'status'])
  })
})
