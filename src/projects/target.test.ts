import { describe, expect, it } from 'vitest'
import { nameRefusal, targetKind } from './target.js'

const kinds = (inputs: string[], platform: NodeJS.Platform) => inputs.map((input) => targetKind(input, platform).kind)

describe('targetKind', () => {
  it('reads nothing typed as blank, and blanks or a paragraph as no folder and no address', () => {
    expect(targetKind('', 'linux').kind).toBe('blank')
    expect(kinds(['   ', '\t', 'clone my app\nplease', 'my app', 'https://github.com/me/app.git now'], 'linux')).toEqual(['none', 'none', 'none', 'none', 'none'])
  })

  it('reads URLs of a scheme git clones as addresses, with their host', () => {
    expect(targetKind('https://github.com/me/app.git', 'win32')).toEqual({ kind: 'address', host: 'github.com' })
    expect(targetKind(' http://git.example.com:3000/me/app ', 'linux')).toEqual({ kind: 'address', host: 'git.example.com' })
    expect(targetKind('ssh://git@example.com:2222/me/app.git', 'darwin')).toEqual({ kind: 'address', host: 'example.com' })
    expect(targetKind('git://example.com/app', 'linux')).toEqual({ kind: 'address', host: 'example.com' })
    expect(targetKind('ftp://example.com/app', 'linux').kind).toBe('none')
    expect(targetKind('https://', 'linux').kind).toBe('none')
  })

  it('reads host:path with no slash before the colon as an scp address, as git does', () => {
    expect(targetKind('git@github.com:me/app.git', 'win32')).toEqual({ kind: 'address', host: 'github.com' })
    expect(targetKind('server:repos/app', 'linux')).toEqual({ kind: 'address', host: 'server' })
    expect(targetKind('foo:bar', 'darwin')).toEqual({ kind: 'address', host: 'foo' })
    expect(targetKind('./a:b', 'linux').kind).toBe('relative')
    expect(targetKind('/srv/a:b', 'linux').kind).toBe('path')
  })

  it('reads one letter before the colon as a drive on Windows only', () => {
    expect(kinds(['C:\\Projects\\app', 'C:/Projects/app', 'd:\\'], 'win32')).toEqual(['path', 'path', 'path'])
    expect(targetKind('C:', 'win32').kind).toBe('relative')
    expect(targetKind('C:app', 'win32').kind).toBe('relative')
    expect(targetKind('C:/x', 'linux')).toEqual({ kind: 'address', host: 'C' })
    expect(targetKind('C:\\x', 'darwin')).toEqual({ kind: 'address', host: 'C' })
  })

  it('reads full paths and the home shorthand as paths', () => {
    expect(kinds(['\\\\server\\share\\app', '~', '~/x', '~\\x', 'C:\\My Projects\\app'], 'win32')).toEqual(['path', 'path', 'path', 'path', 'path'])
    expect(kinds(['/home/me/app', '~', '~/x', '/Users/me/My Projects/app'], 'linux')).toEqual(['path', 'path', 'path', 'path'])
    expect(targetKind('~\\x', 'linux').kind).toBe('relative')
  })

  it('refuses to guess a relative path: a slash, a dot or a tilde of another user', () => {
    expect(kinds(['./my-app', 'src/app', '..\\x', '.', '..', '~user/x', '~user'], 'linux')).toEqual(Array(7).fill('relative'))
    expect(kinds(['./my-app', 'src\\app', '..\\x', '.', '..'], 'win32')).toEqual(Array(5).fill('relative'))
  })

  it('reads a bare name on every platform', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as const) expect(targetKind('my-app', platform).kind).toBe('name')
    expect(targetKind('My.App_2', 'darwin').kind).toBe('name')
  })
})

describe('nameRefusal', () => {
  it('refuses on Windows its forbidden characters, device names and a name ending with a dot or a space', () => {
    expect(nameRefusal('a<b', 'win32')).toMatchObject({ code: 'wizard.folderName', params: { value: 'a<b' } })
    expect(nameRefusal('a?b', 'win32')).toMatchObject({ code: 'wizard.folderName' })
    expect(nameRefusal('CON', 'win32')).toMatchObject({ code: 'wizard.reservedName', params: { value: 'CON' } })
    expect(nameRefusal('nul.txt', 'win32')).toMatchObject({ code: 'wizard.reservedName' })
    expect(nameRefusal('lpt1', 'win32')).toMatchObject({ code: 'wizard.reservedName' })
    expect(nameRefusal('app.', 'win32')).toMatchObject({ code: 'wizard.nameEnd' })
    expect(nameRefusal('console', 'win32')).toBeNull()
  })

  it('refuses on macOS and Linux only a slash and the dot names', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      expect(nameRefusal('a<b?', platform)).toBeNull()
      expect(nameRefusal('CON', platform)).toBeNull()
      expect(nameRefusal('a/b', platform)).toMatchObject({ code: 'wizard.folderNameSlash' })
      expect(nameRefusal('..', platform)).toMatchObject({ code: 'wizard.folderNameSlash' })
    }
    expect(nameRefusal('a\\b', 'win32')).toMatchObject({ code: 'wizard.folderName' })
  })
})
