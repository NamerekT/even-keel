import { describe, expect, it } from 'vitest'
import { expandHome, isFullPath } from './folder.js'

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

describe('isFullPath', () => {
  it('tells a full path from a relative one by the platform', () => {
    expect(isFullPath('/a/b', 'linux')).toBe(true)
    expect(isFullPath('a/b', 'linux')).toBe(false)
    expect(isFullPath('C:\\a', 'win32')).toBe(true)
    expect(isFullPath('a\\b', 'win32')).toBe(false)
  })
})
