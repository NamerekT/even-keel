import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitSetup, gitInstallCommand, initRepository, onPath, readGitSetup, saveIdentity } from './setup.js'
import type { GitResult } from './types.js'

const home = 'C:\\Users\\john'
const MISSING: GitResult = { code: -1, out: 'spawn git ENOENT', missing: true }
const noStart = async () => null

function fakeGit(answers: Record<string, GitResult> = {}) {
  const calls: string[] = []
  const git = async (cwd: string, args: string[]): Promise<GitResult> => {
    const command = `${cwd} ${args.join(' ')}`
    calls.push(command)
    return answers[command] ?? answers[args.join(' ')] ?? { code: 0, out: '' }
  }
  return { git, calls }
}

const folders: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function folder(): string {
  const made = mkdtempSync(join(tmpdir(), 'ek-git-setup-'))
  folders.push(made)
  return made
}

describe('readGitSetup', () => {
  it('reads the version and the name and e-mail commits are made as', async () => {
    const { git } = fakeGit({
      '--version': { code: 0, out: 'git version 2.47.1.windows.2' },
      'config --get user.name': { code: 0, out: 'John Doe\n' },
      'config --get user.email': { code: 0, out: 'john@example.com' },
    })
    expect(await readGitSetup(git, home)).toEqual({ version: '2.47.1', name: 'John Doe', email: 'john@example.com' })
  })

  it('says an unset name or e-mail as null', async () => {
    const { git } = fakeGit({ '--version': { code: 0, out: 'git version 2.39.5 (Apple Git-154)' }, 'config --get user.name': { code: 1, out: '' }, 'config --get user.email': { code: 0, out: '  ' } })
    expect(await readGitSetup(git, home)).toEqual({ version: '2.39.5', name: null, email: null })
  })

  it('says git that does not start as no version, and asks nothing more', async () => {
    const { git, calls } = fakeGit({ '--version': MISSING })
    expect(await readGitSetup(git, home, () => null, noStart)).toEqual({ version: null, name: null, email: null })
    expect(calls).toHaveLength(1)
  })

  it('gives the command that installs git only when git does not start', async () => {
    const install = () => 'winget install --id Git.Git -e'
    expect(await readGitSetup(fakeGit({ '--version': MISSING }).git, home, install, noStart)).toEqual({ version: null, name: null, email: null, install: 'winget install --id Git.Git -e' })
    expect(await readGitSetup(fakeGit({ '--version': { code: 0, out: 'git version 2.47.1' } }).git, home, install, noStart)).not.toHaveProperty('install')
  })

  it('says how Even Keel was started on Windows only when git does not start: the restart that finds a new git depends on it', async () => {
    const start = async () => ({ by: 'service', name: 'EvenKeel' }) as const
    expect(await readGitSetup(fakeGit({ '--version': MISSING }).git, home, () => null, start)).toEqual({ version: null, name: null, email: null, restart: { by: 'service', name: 'EvenKeel' } })
    expect(await readGitSetup(fakeGit({ '--version': { code: 0, out: 'git version 2.47.1' } }).git, home, () => null, start)).not.toHaveProperty('restart')
  })
})

describe('gitInstallCommand', () => {
  const having =
    (...bins: string[]) =>
    (bin: string) =>
      bins.includes(bin)

  it('installs with winget on Windows, and gives nothing without it', () => {
    expect(gitInstallCommand('win32', having('winget'))).toBe('winget install --id Git.Git -e')
    expect(gitInstallCommand('win32', having())).toBeNull()
  })

  it('installs with brew on macOS, otherwise with the command line tools', () => {
    expect(gitInstallCommand('darwin', having('brew'))).toBe('brew install git')
    expect(gitInstallCommand('darwin', having())).toBe('xcode-select --install')
  })

  it.each([
    ['apt-get', 'sudo apt install git'],
    ['dnf', 'sudo dnf install git'],
    ['pacman', 'sudo pacman -S git'],
    ['zypper', 'sudo zypper install git'],
    ['apk', 'sudo apk add git'],
  ])('installs with %s on Linux', (bin, command) => {
    expect(gitInstallCommand('linux', having(bin))).toBe(command)
  })

  it('takes the first package manager found on Linux, and gives nothing without one', () => {
    expect(gitInstallCommand('linux', having('apk', 'dnf'))).toBe('sudo dnf install git')
    expect(gitInstallCommand('linux', having('yum'))).toBeNull()
    expect(gitInstallCommand('freebsd', having('apt-get'))).toBeNull()
  })
})

describe('onPath', () => {
  it('finds a package manager on the PATH without starting it', () => {
    // The host's own platform: a real folder of a Linux runner read as win32 joins to a path that is not there.
    const dir = folder()
    writeFileSync(join(dir, process.platform === 'win32' ? 'winget.exe' : 'winget'), '')
    expect(onPath('winget', { PATH: dir })).toBe(true)
    expect(onPath('brew', { PATH: dir })).toBe(false)
  })
})

describe('saveIdentity', () => {
  it('writes both into the global config, trimmed', async () => {
    const { git, calls } = fakeGit()
    await saveIdentity(git, home, ' John Doe ', 'john@example.com ')
    expect(calls).toEqual([`${home} config --global user.name John Doe`, `${home} config --global user.email john@example.com`])
  })

  it('refuses a blank name or e-mail and writes nothing', async () => {
    const { git, calls } = fakeGit()
    await expect(saveIdentity(git, home, 'John Doe', ' ')).rejects.toMatchObject({ notice: { code: 'git.identityBlank' } })
    expect(calls).toEqual([])
  })

  it('says git that is gone as missing', async () => {
    const { git } = fakeGit({ [`${home} config --global user.name John Doe`]: MISSING })
    await expect(saveIdentity(git, home, 'John Doe', 'john@example.com')).rejects.toMatchObject({ notice: { code: 'git.missing' } })
  })

  it('names the failure with git’s own words', async () => {
    const { git } = fakeGit({ [`${home} config --global user.email john@example.com`]: { code: 255, out: 'error: could not lock config file' } })
    await expect(saveIdentity(git, home, 'John Doe', 'john@example.com')).rejects.toMatchObject({ notice: { code: 'git.identityFailed', detail: 'error: could not lock config file' } })
  })
})

describe('initRepository', () => {
  const identity = { 'config --get user.name': { code: 0, out: 'John Doe' }, 'config --get user.email': { code: 0, out: 'john@example.com' } }

  it('makes a folder without a repository one, on the given branch, with an empty first commit', async () => {
    const path = folder()
    const { git, calls } = fakeGit({ ...identity, 'rev-parse --show-toplevel': { code: 128, out: 'fatal: not a git repository' } })
    await initRepository(git, path, 'trunk')
    expect(calls.map((call) => call.slice(path.length + 1)).filter((call) => !call.startsWith('config --get'))).toEqual([
      'check-ref-format --branch trunk',
      'rev-parse --show-toplevel',
      'init -b trunk',
      'commit --allow-empty -m Initial commit',
    ])
  })

  it('gives the unborn branch of a fresh repository the given name before its first commit', async () => {
    const path = folder()
    const { git, calls } = fakeGit({ ...identity, 'rev-parse --show-toplevel': { code: 0, out: path }, 'rev-parse --verify --quiet HEAD': { code: 1, out: '' } })
    await initRepository(git, path, 'trunk')
    expect(calls).toContain(`${path} symbolic-ref HEAD refs/heads/trunk`)
    expect(calls).toContain(`${path} commit --allow-empty -m Initial commit`)
    expect(calls.some((call) => call.includes(' init '))).toBe(false)
  })

  it('leaves a repository that has commits alone', async () => {
    const path = folder()
    const { git, calls } = fakeGit({ ...identity, 'rev-parse --show-toplevel': { code: 0, out: path }, 'rev-parse --verify --quiet HEAD': { code: 0, out: 'abc' } })
    await initRepository(git, path, 'trunk')
    expect(calls.some((call) => call.includes('commit') || call.includes('symbolic-ref'))).toBe(false)
  })

  it('refuses a folder that is not there, a file, and a bad branch name', async () => {
    const path = folder()
    const file = join(path, 'notes.txt')
    writeFileSync(file, '')
    const { git, calls } = fakeGit({ 'check-ref-format --branch bad name': { code: 1, out: 'fatal' } })
    await expect(initRepository(git, join(path, 'nowhere'), 'trunk')).rejects.toMatchObject({ notice: { code: 'wizard.noFolder' } })
    await expect(initRepository(git, file, 'trunk')).rejects.toMatchObject({ notice: { code: 'wizard.noFolder' } })
    await expect(initRepository(git, path, 'bad name')).rejects.toMatchObject({ notice: { code: 'wizard.branchName', params: { value: 'bad name' } } })
    expect(calls.some((call) => call.includes(' init '))).toBe(false)
  })

  it('refuses before anything is made while git has no name or e-mail for the commit', async () => {
    const path = folder()
    const { git, calls } = fakeGit({ 'config --get user.name': { code: 0, out: 'John Doe' }, 'config --get user.email': { code: 1, out: '' } })
    await expect(initRepository(git, path, 'trunk')).rejects.toMatchObject({ notice: { code: 'git.noIdentity' } })
    expect(calls.some((call) => call.includes(' init ') || call.includes('commit'))).toBe(false)
  })

  it('says git that is gone as missing', async () => {
    const path = folder()
    const { git } = fakeGit({ 'check-ref-format --branch trunk': MISSING })
    await expect(initRepository(git, path, 'trunk')).rejects.toMatchObject({ notice: { code: 'git.missing' } })
  })

  it('names a failed init or commit with git’s own words', async () => {
    const path = folder()
    const { git } = fakeGit({ ...identity, 'rev-parse --show-toplevel': { code: 128, out: 'fatal' }, 'init -b trunk': { code: 128, out: 'fatal: cannot mkdir' } })
    await expect(initRepository(git, path, 'trunk')).rejects.toMatchObject({ notice: { code: 'git.initFailed', params: { path }, detail: 'fatal: cannot mkdir' } })
  })
})

describe('GitSetup', () => {
  it.skipIf(process.platform !== 'win32')('expands service variables before creating a repository', async () => {
    const path = folder()
    vi.stubEnv('EKR_TEST_FOLDER', path)
    const { git, calls } = fakeGit({
      'config --get user.name': { code: 0, out: 'John Doe' },
      'config --get user.email': { code: 0, out: 'john@example.com' },
      'rev-parse --show-toplevel': { code: 128, out: 'fatal: not a git repository' },
    })
    await new GitSetup(git, home).init('%ekr_test_folder%', 'trunk')
    expect(calls).toContain(`${path} init -b trunk`)
  })

  it('has no view before its first read, then the read one; a saved identity is read again', async () => {
    let name = ''
    const git = async (_cwd: string, args: string[]): Promise<GitResult> => {
      const command = args.join(' ')
      if (command === '--version') return { code: 0, out: 'git version 2.47.1' }
      if (command === 'config --global user.name John Doe') name = 'John Doe'
      if (command === 'config --get user.name') return name === '' ? { code: 1, out: '' } : { code: 0, out: name }
      return { code: 0, out: command === 'config --get user.email' ? 'john@example.com' : '' }
    }
    let changes = 0
    const setup = new GitSetup(git, home)
    setup.changed = () => changes++
    expect(setup.view()).toBeUndefined()
    await setup.check()
    expect(setup.view()).toEqual({ version: '2.47.1', name: null, email: 'john@example.com' })
    await setup.identity('John Doe', 'john@example.com')
    expect(setup.view()?.name).toBe('John Doe')
    expect(changes).toBe(2)
  })
})
