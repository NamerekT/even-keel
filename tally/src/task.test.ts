import { describe, expect, it } from 'vitest'
import { placeOf, taskOf } from './task.js'

describe('taskOf', () => {
  it('takes the task from a task branch', () => {
    expect(taskOf({ branch: 'btn-46/task', cwd: 'D:\\Projects\\Baton' })).toBe('BTN-46')
    expect(taskOf({ branch: 'CBL-318/fix-drones' })).toBe('CBL-318')
  })

  it('takes the task from a worktree folder when the branch says nothing', () => {
    expect(taskOf({ branch: 'main', cwd: 'D:\\Projects\\Baton\\.claude\\worktrees\\btn-12\\src' })).toBe('BTN-12')
    expect(taskOf({ branch: 'HEAD', cwd: '/d/Projects/Baton/.claude/worktrees/btn-7' })).toBe('BTN-7')
  })

  it('prefers the launch journal over the branch', () => {
    expect(taskOf({ launch: 'BTN-50', branch: 'btn-46/task' })).toBe('BTN-50')
  })

  it('returns null when nothing names a task', () => {
    expect(taskOf({ branch: 'main', cwd: 'D:\\Projects\\Baton' })).toBeNull()
    expect(taskOf({ cwd: 'D:\\Projects\\Baton\\.claude\\worktrees\\baton' })).toBeNull()
    expect(taskOf({})).toBeNull()
  })
})

describe('placeOf', () => {
  it('cuts the worktree tail off the project folder', () => {
    expect(placeOf('D:\\Projects\\git\\private\\Baton\\.claude\\worktrees\\btn-46\\tally')).toEqual({
      project: 'Baton',
      dir: 'D:\\Projects\\git\\private\\Baton',
    })
    expect(placeOf('D:\\Projects\\git\\private\\Gamma')).toEqual({ project: 'Gamma', dir: 'D:\\Projects\\git\\private\\Gamma' })
    expect(placeOf('/home/john/app/')).toEqual({ project: 'app', dir: '/home/john/app' })
  })

  it('returns nulls without a folder', () => {
    expect(placeOf(undefined)).toEqual({ project: null, dir: null })
  })
})
