import { describe, expect, it } from 'vitest'
import { expandFolder, expandHome, isFullPath } from './folder.js'

describe('expandHome', () => {
  it.each([
    ['~', '/home/u'],
    ['~/Projects/demo', '/home/u/Projects/demo'],
    ['~user/x', '~user/x'],
    ['$HOME/x', '$HOME/x'],
    ['/abs/~/x', '/abs/~/x'],
    ['~\\x', '~\\x'],
  ])('on Linux %s -> %s', (typed, expected) => {
    expect(expandHome(typed, '/home/u', 'linux')).toBe(expected)
  })

  it('takes both slashes after ~ on Windows', () => {
    expect(expandHome('~\\src', 'C:\\Users\\u', 'win32')).toBe('C:\\Users\\u\\src')
    expect(expandHome('~/src', 'C:\\Users\\u', 'win32')).toBe('C:\\Users\\u\\src')
    expect(expandHome('~user\\src', 'C:\\Users\\u', 'win32')).toBe('~user\\src')
  })
})

describe('expandFolder', () => {
  const env = { UserProfile: 'C:\\Users\\u', PART: 'repo', EMPTY: '', NESTED: '%PART%', TILDE: '~', DOLLAR: '$&' }

  it.each([
    ['%USERPROFILE%\\x', 'C:\\Users\\u\\x'],
    ['%userprofile%/%part%', 'C:\\Users\\u/repo'],
    ['%NOPE%\\x', '%NOPE%\\x'],
    ['%EMPTY%\\x', '%EMPTY%\\x'],
    ['%NESTED%\\x', '%PART%\\x'],
    ['%TILDE%\\x', '~\\x'],
    ['%DOLLAR%\\x', '$&\\x'],
    ['~\\%PART%', 'C:\\Users\\u\\repo'],
    ['$env:UserProfile\\x', '$env:UserProfile\\x'],
    ['$UserProfile\\x', '$UserProfile\\x'],
    ['C:\\100%\\x', 'C:\\100%\\x'],
    ['%%', '%%'],
  ])('on Windows %s -> %s', (typed, expected) => {
    expect(expandFolder(typed, 'C:\\Users\\u', 'win32', env)).toBe(expected)
  })

  it.each(['linux', 'darwin'] as const)('keeps percent variables literal on %s', (platform) => {
    expect(expandFolder('%USERPROFILE%/x', '/home/u', platform, env)).toBe('%USERPROFILE%/x')
    expect(expandFolder('~/%PART%', '/home/u', platform, env)).toBe('/home/u/%PART%')
  })
})

describe('isFullPath', () => {
  it('tells a full path from a relative one by the platform', () => {
    expect(isFullPath('/a/b', 'linux')).toBe(true)
    expect(isFullPath('a/b', 'linux')).toBe(false)
    expect(isFullPath('C:\\a', 'win32')).toBe(true)
    expect(isFullPath('a\\b', 'win32')).toBe(false)
  })
})
