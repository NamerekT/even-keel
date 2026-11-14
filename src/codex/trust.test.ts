import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { noticeOf } from '../notice/notice.js'
import { DEFAULT_PROTECTION } from '../sessions/protection.js'
import { CodexCli } from './cli.js'
import { CodexPlugins } from './plugins.js'
import { PROTECTION_FILE } from './protection.js'
import { projectKey, trustProject, withProjectTrust } from './trust.js'
import { TurnRegistry } from './turns.js'

describe('projectKey', () => {
  it('spells a Windows folder as Codex writes it: lower case, backslashes', () => {
    expect(projectKey('D:/Projects/Repo', 'win32', (path) => path.replaceAll('/', '\\'))).toBe('d:\\projects\\repo')
  })

  it('keeps the real path elsewhere', () => {
    expect(projectKey('/tmp/Repo', 'linux', () => '/private/tmp/Repo')).toBe('/private/tmp/Repo')
  })
})

describe('withProjectTrust', () => {
  const key = 'd:\\repo'

  it('appends a table to a file without the folder, keeping everything else', () => {
    const text = 'model = "gpt-5"\n\n[projects.\'d:\\other\']\ntrust_level = "trusted"\n'
    expect(withProjectTrust(text, 'D:\\repo', key, 'win32')).toEqual({ kind: 'write', text: `${text}\n[projects.'d:\\repo']\ntrust_level = "trusted"\n` })
  })

  it('starts an empty file with the table alone', () => {
    expect(withProjectTrust('', 'D:\\repo', key, 'win32')).toEqual({ kind: 'write', text: '[projects.\'d:\\repo\']\ntrust_level = "trusted"\n' })
  })

  it('adds the missing newline and keeps the file\'s line endings', () => {
    expect(withProjectTrust('model = "x"', 'D:\\repo', key, 'win32')).toEqual({ kind: 'write', text: 'model = "x"\n\n[projects.\'d:\\repo\']\ntrust_level = "trusted"\n' })
    expect(withProjectTrust('a = 1\r\n', 'D:\\repo', key, 'win32')).toEqual({ kind: 'write', text: 'a = 1\r\n\r\n[projects.\'d:\\repo\']\r\ntrust_level = "trusted"\r\n' })
  })

  it('takes an entry under another spelling of the folder, quoted either way', () => {
    expect(withProjectTrust('[projects.\'D:\\Repo\']\ntrust_level = "trusted"\n', 'D:\\repo', key, 'win32')).toEqual({ kind: 'trusted' })
    expect(withProjectTrust('[projects."D:\\\\Repo"]\ntrust_level = \'trusted\'  # by hand\n', 'D:\\repo', key, 'win32')).toEqual({ kind: 'trusted' })
    expect(withProjectTrust('[ projects . \'D:/repo\' ] # note\ntrust_level="trusted"\n', 'D:\\repo', key, 'win32')).toEqual({ kind: 'trusted' })
  })

  it('leaves a folder the user marked untrusted alone', () => {
    expect(withProjectTrust('[projects.\'d:\\repo\']\ntrust_level = "untrusted"\n', 'D:\\repo', key, 'win32')).toEqual({ kind: 'refused' })
  })

  it('adds the level into an entry that has none, before the next table', () => {
    const text = '[projects.\'d:\\repo\']\nnote = 1\n\n[tui]\ntrust_level = "untrusted"\n'
    expect(withProjectTrust(text, 'D:\\repo', key, 'win32')).toEqual({ kind: 'write', text: '[projects.\'d:\\repo\']\ntrust_level = "trusted"\nnote = 1\n\n[tui]\ntrust_level = "untrusted"\n' })
  })

  it('does not read the level of another table as the folder\'s', () => {
    const text = '[projects.\'d:\\other\']\ntrust_level = "untrusted"\n'
    expect(withProjectTrust(text, 'D:\\repo', key, 'win32')).toMatchObject({ kind: 'write' })
  })

  it('quotes a folder with an apostrophe as a basic string', () => {
    expect(withProjectTrust('', "/home/o'neil/repo", "/home/o'neil/repo", 'linux')).toEqual({ kind: 'write', text: '[projects."/home/o\'neil/repo"]\ntrust_level = "trusted"\n' })
  })

  it.each([
    'projects = { "d:\\\\other" = { trust_level = "trusted" } }\n',
    '[projects]\n"d:\\\\other".trust_level = "trusted"\n',
    'projects."d:\\\\other".trust_level = "trusted"\n',
  ])('does not add a table where projects are written another way: %s', (text) => {
    expect(withProjectTrust(text, 'D:\\repo', key, 'win32')).toEqual({ kind: 'unknownShape' })
  })
})

describe('trustProject', () => {
  const folders: string[] = []
  const config = () => {
    const folder = mkdtempSync(join(tmpdir(), 'ek-codex-trust-'))
    folders.push(folder)
    return join(folder, 'config.toml')
  }
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('creates the account\'s config.toml and leaves it as it is the second time', () => {
    const file = config()
    trustProject(file, 'D:\\Repo', 'win32')
    const first = readFileSync(file, 'utf8')
    expect(first).toContain('trust_level = "trusted"')
    trustProject(file, 'D:\\Repo', 'win32')
    expect(readFileSync(file, 'utf8')).toBe(first)
  })

  it('logs and writes nothing for a folder the user marked untrusted', () => {
    const file = config()
    const text = '[projects.\'d:\\repo\']\ntrust_level = "untrusted"\n'
    writeFileSync(file, text)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    trustProject(file, 'D:\\repo', 'win32')
    expect(readFileSync(file, 'utf8')).toBe(text)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('untrusted'))
  })

  it('runs before every Codex launch with Protection, beside the folder\'s rules file', async () => {
    const file = config()
    const home = join(file, '..')
    const repo = join(home, 'repo')
    const cli = new CodexCli(() => join(home, 'no-codex.exe'), 1000, () => ({}), new TurnRegistry(home), {} as CodexPlugins)
    const start = { name: 'EXAMPLE-1', cwd: repo, prompt: 'Example task', model: null, protection: DEFAULT_PROTECTION, outsideRepo: true, trustedRepo: repo }
    await expect(cli.launch({ key: 'example', dir: home, global: false, agent: 'codex' }, start)).rejects.toThrow()
    expect(withProjectTrust(readFileSync(file, 'utf8'), repo, projectKey(repo))).toEqual({ kind: 'trusted' })
    expect(readFileSync(join(repo, '.codex', 'rules', PROTECTION_FILE), 'utf8')).toContain('"git"')
  })

  it('fails the launch when the file cannot be read', () => {
    const file = config()
    let thrown: unknown
    try { trustProject(join(file, '..'), 'D:\\repo', 'win32') } catch (error) { thrown = error }
    expect(noticeOf(thrown)).toMatchObject({ code: 'codex.trustWriteFailed', params: { folder: 'D:\\repo' } })
  })
})
