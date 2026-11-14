import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { binaryPath, findBinary, isInside, pathKey, relativeUnder, samePath, spelledUnder, workingFolder, writtenUnder } from './paths.js'

describe('a folder behind a link', () => {
  let root: string
  let real: string
  let link: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'even-keel-paths-'))
    real = join(root, 'real')
    link = join(root, 'link')
    mkdirSync(join(real, 'repo', '.claude', 'worktrees', 'abc-1'), { recursive: true })
    symlinkSync(real, link, 'junction')
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('is the same path as its target, the parts not created yet too', () => {
    expect(samePath(join(link, 'repo'), join(real, 'repo'))).toBe(true)
    expect(samePath(join(link, 'repo', '.claude', 'worktrees', 'abc-2'), join(real, 'repo', '.claude', 'worktrees', 'abc-2'))).toBe(true)
    expect(samePath(join(link, 'repo'), join(real, 'repo', '.claude'))).toBe(false)
  })

  it('holds what its target holds', () => {
    expect(isInside(join(real, 'repo', '.claude', 'worktrees', 'abc-1'), join(link, 'repo'))).toBe(true)
    expect(isInside(join(link, 'repo', 'src'), join(real, 'repo'))).toBe(true)
  })

  it('spells a real path inside it under the link', () => {
    expect(spelledUnder(join(real, 'repo', '.claude', 'worktrees', 'abc-1'), join(link, 'repo'))).toBe(join(link, 'repo', '.claude', 'worktrees', 'abc-1'))
    expect(spelledUnder(join(real, 'repo'), join(link, 'repo'))).toBe(join(link, 'repo'))
    expect(spelledUnder(join(real, 'repo', 'abc-9'), join(link, 'repo'))).toBe(join(link, 'repo', 'abc-9'))
  })

  it('leaves a path outside it as it is', () => {
    expect(spelledUnder(join(root, 'elsewhere'), join(link, 'repo'))).toBe(join(root, 'elsewhere'))
  })
})

describe('relativeUnder', () => {
  it('gives forward slashes, ignoring drive letter case and slash direction on Windows', () => {
    expect(relativeUnder('d:\\Projects\\repo\\.claude\\worktrees\\abc-1', 'D:/Projects/repo', 'win32')).toBe('.claude/worktrees/abc-1')
  })

  it('gives null for the folder itself and for a path outside it', () => {
    expect(relativeUnder('D:\\Projects\\repo', 'D:\\Projects\\repo', 'win32')).toBeNull()
    expect(relativeUnder('D:\\Projects\\repo-slot-1', 'D:\\Projects\\repo', 'win32')).toBeNull()
    expect(relativeUnder('/srv/other/abc-1', '/srv/repo', 'linux')).toBeNull()
  })

  it('keeps case on Linux', () => {
    expect(relativeUnder('/srv/repo/.claude/worktrees/abc-1', '/srv/repo', 'linux')).toBe('.claude/worktrees/abc-1')
    expect(relativeUnder('/srv/Repo/abc-1', '/srv/repo', 'linux')).toBeNull()
  })
})

describe('writtenUnder', () => {
  it('gives the path as written under the folder, with forward slashes', () => {
    expect(writtenUnder('d:\\Projects\\repo\\.temp\\note-link\\pull.md', 'D:/Projects/repo', 'win32')).toBe('.temp/note-link/pull.md')
    expect(writtenUnder('/srv/repo/.temp/../.temp/pull.md', '/srv/repo', 'linux')).toBe('.temp/pull.md')
  })

  it('gives null for the folder itself and for a path written outside it', () => {
    expect(writtenUnder('D:\\Projects\\repo', 'D:\\Projects\\repo', 'win32')).toBeNull()
    expect(writtenUnder('D:\\Projects\\repo\\..\\other\\pull.md', 'D:\\Projects\\repo', 'win32')).toBeNull()
    expect(writtenUnder('/srv/Repo/pull.md', '/srv/repo', 'linux')).toBeNull()
  })
})

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

describe('workingFolder', () => {
  const resolvesTo = (real: string) => () => real
  const unresolved = () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) }

  it('resolves a Windows junction on the same drive (EKR-96)', () => {
    expect(workingFolder('c:\\ek\\link', 'win32', resolvesTo('C:\\ek\\repo'))).toBe('C:\\ek\\repo')
  })

  it.each([
    ['a subst drive moved to its target drive', 'X:\\repo', 'C:\\real\\repo'],
    ['a mapped drive turned into a UNC path', 'Z:\\repo', '\\\\server\\share\\repo'],
    ['a long-path prefix', 'C:\\ek\\link', '\\\\?\\C:\\ek\\repo'],
    ['a volume without a drive letter', 'C:\\ek\\link', '\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\repo'],
  ])('keeps a Windows folder as written for %s', (_, folder, real) => {
    expect(workingFolder(folder, 'win32', resolvesTo(real))).toBe(folder)
  })

  it('keeps a folder that cannot be resolved as written', () => {
    expect(workingFolder('C:\\missing', 'win32', unresolved)).toBe('C:\\missing')
    expect(workingFolder('/missing', 'linux', unresolved)).toBe('/missing')
  })

  it('resolves a link off Windows', () => {
    expect(workingFolder('/tmp/repo', 'darwin', resolvesTo('/private/tmp/repo'))).toBe('/private/tmp/repo')
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

describe('findBinary', () => {
  const at = (...files: string[]) => (path: string) => files.includes(path)

  it('takes a path as it is', () => {
    expect(findBinary('/opt/codex/bin/codex', {}, 'linux', at('/opt/codex/bin/codex'))).toBe(true)
    expect(findBinary('C:\\tools\\codex.exe', {}, 'win32', at())).toBe(false)
  })

  it('looks a bare name up on the PATH', () => {
    expect(findBinary('codex', { PATH: '/usr/bin:/home/john/.npm/bin' }, 'linux', at('/home/john/.npm/bin/codex'))).toBe(true)
    expect(findBinary('codex', { PATH: '/usr/bin' }, 'linux', at('/home/john/.npm/bin/codex'))).toBe(false)
    expect(findBinary('codex', {}, 'linux', at('/usr/bin/codex'))).toBe(false)
  })

  it('tries on Windows only the extensions spawn does, whatever the case of the variable', () => {
    const env = { Path: 'C:\\Windows;C:\\Users\\john\\AppData\\Roaming\\npm' }
    expect(findBinary('codex', env, 'win32', at('C:\\Users\\john\\AppData\\Roaming\\npm\\codex.exe'))).toBe(true)
    expect(findBinary('codex', env, 'win32', at('C:\\Users\\john\\AppData\\Roaming\\npm\\codex.cmd'))).toBe(false)
    expect(findBinary('copilot', env, 'win32', at('C:\\Users\\john\\AppData\\Roaming\\npm\\copilot'))).toBe(false)
  })
})

describe('binaryPath', () => {
  const at = (...files: string[]) => (path: string) => files.includes(path)
  it('resolves an override relative to the launching checkout', () => {
    expect(binaryPath('../cli/claude', {}, '/work/repo', 'linux')).toBe('/work/cli/claude')
  })
  it('freezes PATH search order and Windows executable extensions', () => {
    expect(binaryPath('claude', { PATH: '/one:/two' }, '/work', 'linux', at('/one/claude', '/two/claude'))).toBe('/one/claude')
    expect(binaryPath('claude', { Path: 'D:\\tools' }, 'D:\\repo', 'win32', at('D:\\tools\\claude.exe'))).toBe('D:\\tools\\claude.exe')
    expect(binaryPath('claude.exe', { Path: 'D:\\tools' }, 'D:\\repo', 'win32', at('D:\\tools\\claude.exe'))).toBe('D:\\tools\\claude.exe')
    expect(binaryPath('claude', { Path: 'D:\\tools' }, 'D:\\repo', 'win32', at('D:\\repo\\claude.exe', 'D:\\tools\\claude.exe'))).toBe('D:\\repo\\claude.exe')
    expect(binaryPath('claude', {}, '/work', 'linux', at())).toBeUndefined()
  })
})
