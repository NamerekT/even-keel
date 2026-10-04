import { describe, expect, it } from 'vitest'
import { isInside, pathKey, samePath } from './paths.js'

describe('samePath', () => {
  it('ignores case and slash direction on Windows', () => {
    expect(samePath('D:/Projects/Repo', 'd:\\projects\\repo\\', 'win32')).toBe(true)
  })

  it('ignores case on macOS', () => {
    expect(samePath('/Users/john/Repo', '/users/john/repo/', 'darwin')).toBe(true)
  })

  it('tells paths apart by case on Linux', () => {
    expect(samePath('/home/john/Repo', '/home/john/repo', 'linux')).toBe(false)
    expect(samePath('/home/john/repo/', '/home/john/repo', 'linux')).toBe(true)
  })
})

describe('pathKey', () => {
  it('keeps a Linux path as it is, backslashes included', () => {
    expect(pathKey('/home/john/a\\b', 'linux')).toBe('/home/john/a\\b')
  })

  it('folds the drive letter spellings of the CLI and VS Code into one key', () => {
    expect(pathKey('d:/Projects/Repo', 'win32')).toBe(pathKey('D:\\Projects\\Repo', 'win32'))
  })
})

describe('isInside', () => {
  it('takes the folder itself and its subfolders, not a sibling with the same prefix', () => {
    expect(isInside('/home/john/slot', '/home/john/slot', 'linux')).toBe(true)
    expect(isInside('/home/john/slot/src', '/home/john/slot', 'linux')).toBe(true)
    expect(isInside('/home/john/slot-2', '/home/john/slot', 'linux')).toBe(false)
  })

  it('compares case-insensitively only where the file system does', () => {
    expect(isInside('D:\\Repo\\Slot\\src', 'd:/repo/slot', 'win32')).toBe(true)
    expect(isInside('/home/john/Slot/src', '/home/john/slot', 'linux')).toBe(false)
  })
})
