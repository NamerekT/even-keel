import { describe, expect, it } from 'vitest'
import { placeOf, taskOf } from './task.js'

describe('taskOf', () => {
  it('takes the task from a task branch', () => {
    expect(taskOf({ branch: 'btn-46/task', cwd: 'D:\\Projects\\EvenKeel' })).toBe('BTN-46')
    expect(taskOf({ branch: 'GAME-318/fix-drones' })).toBe('GAME-318')
  })

  it('takes the task from a worktree folder when the branch says nothing', () => {
    expect(taskOf({ branch: 'main', cwd: 'D:\\Projects\\EvenKeel\\.claude\\worktrees\\btn-12\\src' })).toBe('BTN-12')
    expect(taskOf({ branch: 'HEAD', cwd: '/d/Projects/EvenKeel/.claude/worktrees/btn-7' })).toBe('BTN-7')
  })

  it('prefers the launch journal over the branch', () => {
    expect(taskOf({ launch: 'BTN-50', branch: 'btn-46/task' })).toBe('BTN-50')
  })

  it('returns null when nothing names a task', () => {
    expect(taskOf({ branch: 'main', cwd: 'D:\\Projects\\EvenKeel' })).toBeNull()
    expect(taskOf({ cwd: 'D:\\Projects\\EvenKeel\\.claude\\worktrees\\even-keel-2' })).toBeNull()
    expect(taskOf({})).toBeNull()
  })
})

describe('placeOf', () => {
  it('cuts the worktree tail off the project folder', () => {
    expect(placeOf('D:\\Projects\\git\\private\\EvenKeel\\.claude\\worktrees\\btn-46\\tally')).toEqual({
      project: 'EvenKeel',
      dir: 'D:\\Projects\\git\\private\\EvenKeel',
    })
    expect(placeOf('D:\\Projects\\git\\private\\Game')).toEqual({ project: 'Game', dir: 'D:\\Projects\\git\\private\\Game' })
    expect(placeOf('/home/john/app/')).toEqual({ project: 'app', dir: '/home/john/app' })
  })

  it('returns nulls without a folder', () => {
    expect(placeOf(undefined)).toEqual({ project: null, dir: null })
  })
})
