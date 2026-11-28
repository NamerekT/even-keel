import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import type { Git } from '../git/types.js'
import { fromCarried } from '../machine/services.js'
import { wireMachineServices, type MachineServicesContext } from './machine-services.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function rig(workdir: string | null) {
  const home: AccountHome = { key: 'global', dir: '/account', global: true, agent: 'claude' }
  const agent = {
    feed: async () => ({ lines: [] }),
    record: async (_home: AccountHome, sessionId: string) => ({ sessionId, workdir }),
  }
  const services = wireMachineServices({
    homes: { list: () => [home] },
    inHomes: async (find: (home: AccountHome) => Promise<unknown>) => find(home),
    agentOf: () => agent,
    mailbox: { delivered: () => [] },
    configStore: { current: {} },
    promptLanguage: () => 'en',
    taskNote: () => undefined,
  } as unknown as MachineServicesContext, { steer: async () => false, restore: async () => {} })
  return services.transcript
}

/** A git whose global config is a map: `config --global` writes it, `config --get` reads it. */
function configGit(config: Record<string, string> = {}, refuse = false): Git & { calls: string[][] } {
  const calls: string[][] = []
  const git = async (_cwd: string, args: string[]) => {
    calls.push(args)
    if (args[0] === '--version') return { code: 0, out: 'git version 2.47.1' }
    if (args[0] === 'config' && args[1] === '--global') {
      if (refuse) return { code: 255, out: 'error: could not lock config file' }
      config[args[2]!] = args[3]!
      return { code: 0, out: '' }
    }
    const value = config[args[2]!]
    return value === undefined ? { code: 1, out: '' } : { code: 0, out: `${value}\n` }
  }
  return Object.assign(git, { calls })
}

function gitRig(git: Git) {
  return wireMachineServices({ configStore: { current: {} } } as unknown as MachineServicesContext, { steer: async () => false, restore: async () => {}, git, home: '/home/example' }).git
}

describe('git.identity (BTN-1503)', () => {
  it("writes the name and e-mail into the machine's global git config and answers what git reads back", async () => {
    const git = configGit()
    expect(await gitRig(git).identity(' John Doe ', 'john@example.com')).toEqual({ name: 'John Doe', email: 'john@example.com' })
    expect(git.calls).toContainEqual(['config', '--global', 'user.name', 'John Doe'])
    expect(git.calls).toContainEqual(['config', '--global', 'user.email', 'john@example.com'])
  })

  it('refuses a blank field and a config git did not write', async () => {
    await expect(gitRig(configGit()).identity('John Doe', ' ')).rejects.toMatchObject({ notice: { code: 'git.identityBlank' } })
    await expect(gitRig(configGit({}, true)).identity('John Doe', 'john@example.com')).rejects.toMatchObject({ notice: { code: 'git.identityFailed' } })
  })
})

function sessionFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-file-'))
  dirs.push(dir)
  mkdirSync(join(dir, '.temp', 'inbox'), { recursive: true })
  writeFileSync(join(dir, '.temp', 'inbox', 'order.png'), 'picture')
  writeFileSync(join(dir, 'secret.png'), 'secret')
  return dir
}

describe('inboxFile', () => {
  it('gives a picture of the session inbox that its transcript does not name yet', async () => {
    const transcript = rig(sessionFolder())
    const found = await transcript.inboxFile('session-1', 'order.png')
    expect(found?.type).toBe('image/png')
    expect(Buffer.from(fromCarried(found!)).toString()).toBe('picture')
  })

  it('refuses a name with a folder, a missing file and a session without a folder', async () => {
    const transcript = rig(sessionFolder())
    expect(await transcript.inboxFile('session-1', '../../secret.png')).toBeUndefined()
    expect(await transcript.inboxFile('session-1', '..\\..\\secret.png')).toBeUndefined()
    expect(await transcript.inboxFile('session-1', 'other.png')).toBeUndefined()
    expect(await rig(null).inboxFile('session-1', 'order.png')).toBeUndefined()
  })
})

describe('folders.clone (BTN-1566)', () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }).trim()

  /** A repository whose default branch is main, with a dev branch beside it. */
  function upstream(): { root: string; source: string } {
    const root = mkdtempSync(join(tmpdir(), 'machine-clone-'))
    dirs.push(root)
    const source = join(root, 'source')
    mkdirSync(source)
    sh(source, 'init', '-q', '-b', 'main')
    sh(source, '-c', 'user.name=John Doe', '-c', 'user.email=john@example.com', 'commit', '-q', '--allow-empty', '-m', 'first')
    sh(source, 'branch', 'dev')
    return { root, source }
  }

  function folders() {
    const ctx = { configStore: { current: {} }, tell: { credentials: async () => [] }, claudeConfigs: () => [] } as unknown as MachineServicesContext
    return wireMachineServices(ctx, { steer: async () => false, restore: async () => {}, cloneProgress: () => {} }).folders
  }

  it("clones onto the project's main branch, not the remote's default one", async () => {
    const { root, source } = upstream()
    const folder = join(root, 'clone')
    await folders().clone({ project: 'p1', folder, remotes: [source], branch: 'dev', claude: false }, { name: 'origin', url: source }, [])
    expect(sh(folder, 'symbolic-ref', '--short', 'HEAD')).toBe('dev')
  })

  it('refuses a main branch the remote has no copy of', async () => {
    const { root, source } = upstream()
    const folder = join(root, 'clone')
    await expect(folders().clone({ project: 'p1', folder, remotes: [source], branch: 'trunk', claude: false }, { name: 'origin', url: source }, []))
      .rejects.toMatchObject({ notice: { code: 'git.noRemoteBranch', params: { branch: 'trunk', remote: source } } })
  })

  it("adds every other remote of the hub's folder under its own name (BTN-1766)", async () => {
    const { root, source } = upstream()
    const folder = join(root, 'clone')
    const github = 'https://github.example.com/team/abc.git'
    const others = [{ name: 'github', url: github }]
    await folders().clone({ project: 'p1', folder, remotes: [source, github], branch: 'main', claude: false }, { name: 'forge', url: source }, others)
    expect(sh(folder, 'config', '--get-regexp', '^remote\\..*\\.url$').split('\n')).toEqual([`remote.forge.url ${source}`, `remote.github.url ${github}`])
    expect(sh(folder, 'rev-parse', '--abbrev-ref', 'main@{upstream}')).toBe('forge/main')
  })

  it('leaves out a local remote with no folder on the machine', async () => {
    const { root, source } = upstream()
    const folder = join(root, 'clone')
    const others = [{ name: 'backup', url: join(root, 'missing.git') }, { name: 'mirror', url: source }]
    await folders().clone({ project: 'p1', folder, remotes: [source], branch: 'main', claude: false }, { name: 'origin', url: source }, others)
    expect(sh(folder, 'config', '--get-regexp', '^remote\\..*\\.url$').split('\n')).toEqual([`remote.origin.url ${source}`, `remote.mirror.url ${source}`])
  })
})
