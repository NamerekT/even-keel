import { describe, expect, it } from 'vitest'
import { newestExtensionBinary, projectDirName } from './paths.js'

describe('projectDirName', () => {
  it('encodes a working directory the way Claude Code names its transcript folders', () => {
    expect(projectDirName('D:\\Projects\\git\\private\\Baton')).toBe('D--Projects-git-private-Baton')
    expect(projectDirName('C:\\repos\\example\\.claude\\worktrees\\a-1b')).toBe('C--repos-example--claude-worktrees-a-1b')
  })
})

describe('newestExtensionBinary', () => {
  it('picks the newest Claude Code extension by version, not by name order', () => {
    const dirs = [
      'anthropic.claude-code-2.1.99-win32-x64',
      'anthropic.claude-code-2.1.283-win32-x64',
      'anthropic.claude-code-2.1.282-win32-x64',
      'ms-python.python-2026.1.0',
    ]
    expect(newestExtensionBinary(dirs)).toBe('anthropic.claude-code-2.1.283-win32-x64')
  })

  it('returns nothing when the extension is not installed', () => {
    expect(newestExtensionBinary(['ms-python.python-2026.1.0'])).toBeUndefined()
  })
})
