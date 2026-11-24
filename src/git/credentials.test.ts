import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { credentialedRemote, credentialEnv, credentialUrl, credentialUrls, deniedOf, withCredentials, type GitCredential } from './credentials.js'
import type { RemoteGit } from './remote-run.js'
import { REMOTE_URLS_ARGS } from './remote-urls.js'
import type { GitResult } from './types.js'

const token: GitCredential = { url: 'https://github.com/john/repo.git', username: 'x-access-token', password: 'ghp_example', profile: { id: 'p1', name: 'John GitHub' } }

describe('credentialUrl', () => {
  it('keeps an HTTPS remote without its user, query and trailing slash', () => {
    expect(credentialUrl('https://john@github.com/john/repo.git')).toBe('https://github.com/john/repo.git')
    expect(credentialUrl('https://John:secret@GitHub.com/john/repo/')).toBe('https://github.com/john/repo')
    expect(credentialUrl('https://forge.example.com:3000/john/repo.git?x=1')).toBe('https://forge.example.com:3000/john/repo.git')
  })

  it('leaves SSH, plain HTTP, local and broken remotes to git', () => {
    for (const url of ['git@github.com:john/repo.git', 'ssh://git@forge.example.com:2222/john/repo.git', 'http://forge.example.com/john/repo.git', 'D:/repos/repo', '/srv/repo.git', 'https://']) {
      expect(credentialUrl(url)).toBeNull()
    }
  })

  it('reads the HTTPS remotes of git config, each once', () => {
    const out = ['remote.origin.url https://github.com/john/repo.git', 'remote.github.url https://john@github.com/john/repo.git', 'remote.forge.url git@forge.example.com:john/repo.git'].join('\n')
    expect(credentialUrls(out)).toEqual(['https://github.com/john/repo.git'])
  })
})

describe('deniedOf', () => {
  const refused = (out: string): GitResult => ({ code: 128, out })

  it.each([
    ['GitHub', "remote: Write access to repository not granted.\nfatal: unable to access 'https://github.com/john/repo.git/': The requested URL returned error: 403"],
    ['GitHub classic', 'remote: Permission to john/repo.git denied to john.\nfatal: unable to access'],
    ['GitLab', 'remote: You are not allowed to push code to this project.\nfatal: unable to access'],
    ['Forgejo', 'remote: User permission denied for writing.\nfatal: unable to access'],
  ])('names the profile whose token %s refused to write with', (_, out) => {
    expect(deniedOf(refused(out), [token])).toEqual({ profile: 'p1', name: 'John GitHub', url: token.url })
  })

  it('takes the profile of the address git named among several', () => {
    const other: GitCredential = { ...token, url: 'https://forge.example.com/john/repo.git', profile: { id: 'p2', name: 'Forge' } }
    const out = "fatal: unable to access 'https://forge.example.com/john/repo.git/': The requested URL returned error: 403"
    expect(deniedOf(refused(out), [token, other])?.profile).toBe('p2')
  })

  it('is no refusal of writing for a success, another failure or a call without a token', () => {
    expect(deniedOf({ code: 0, out: 'error: 403' }, [token])).toBeNull()
    expect(deniedOf(refused(' ! [rejected]        main -> main (fetch first)'), [token])).toBeNull()
    expect(deniedOf(refused('The requested URL returned error: 403'), [])).toBeNull()
  })
})

describe('withCredentials', () => {
  function fake(urls: string, answer: Partial<GitResult> = {}) {
    const calls: { args: string[]; env?: Readonly<Record<string, string>> }[] = []
    const git = async (_cwd: string, args: string[], env?: Readonly<Record<string, string>>): Promise<GitResult> => {
      calls.push({ args, ...(env === undefined ? {} : { env }) })
      if (args.join(' ') === REMOTE_URLS_ARGS.join(' ')) return { code: urls === '' ? 1 : 0, out: urls }
      return { code: 0, out: '', ...answer }
    }
    return { git, calls }
  }
  const asked: string[][] = []
  const credentialsOf = async (_folder: string, urls: readonly string[]) => {
    asked.push([...urls])
    return urls.includes(token.url) ? [token] : []
  }

  it('gives a push to an HTTPS remote the token of its profile, only in the call\'s environment', async () => {
    const { git, calls } = fake(`remote.origin.url ${token.url}`)
    await withCredentials(git, credentialsOf, {})('/repos/one', ['push', 'origin', 'main'])
    const push = calls.find((call) => call.args[0] === 'push')!
    expect(push.args).toEqual(['push', 'origin', 'main'])
    expect(push.env).toMatchObject({ EVEN_KEEL_GIT_USERNAME_0: 'x-access-token', EVEN_KEEL_GIT_PASSWORD_0: 'ghp_example', GIT_CONFIG_KEY_1: `credential.${token.url}.helper`, GIT_CONFIG_VALUE_1: '' })
  })

  it('asks nothing for a local command, and runs a remote one of an SSH remote as it is', async () => {
    const local = fake(`remote.origin.url ${token.url}`)
    await withCredentials(local.git, credentialsOf, {})('/repos/two', ['status'])
    expect(local.calls).toEqual([{ args: ['status'] }])
    asked.length = 0
    const ssh = fake('remote.origin.url git@github.com:john/repo.git')
    await withCredentials(ssh.git, credentialsOf, {})('/repos/three', ['fetch', 'origin'])
    expect(asked).toEqual([])
    expect(ssh.calls.at(-1)).toEqual({ args: ['fetch', 'origin'] })
  })

  it('marks a push refused for writing with the profile, and leaves a fetch unmarked', async () => {
    const out = 'remote: Write access to repository not granted.\nfatal: The requested URL returned error: 403'
    const { git } = fake(`remote.origin.url ${token.url}`, { code: 128, out })
    const credentialed = withCredentials(git, credentialsOf, {})
    expect((await credentialed('/repos/four', ['push', 'origin', 'main'])).denied).toEqual({ profile: 'p1', name: 'John GitHub', url: token.url })
    expect((await credentialed('/repos/four', ['fetch', 'origin'])).denied).toBeUndefined()
  })

  it('pushes again on git\'s own credentials when the token may not write, and keeps that success', async () => {
    const out = 'remote: Write access to repository not granted.\nfatal: The requested URL returned error: 403'
    const calls: { env?: Readonly<Record<string, string>> }[] = []
    const git = async (_cwd: string, args: string[], env?: Readonly<Record<string, string>>): Promise<GitResult> => {
      if (args.join(' ') === REMOTE_URLS_ARGS.join(' ')) return { code: 0, out: `remote.origin.url ${token.url}` }
      calls.push(env === undefined ? {} : { env })
      return env === undefined ? { code: 0, out: '' } : { code: 128, out }
    }
    expect(await withCredentials(git, credentialsOf, {})('/repos/four', ['push', 'origin', 'main'])).toEqual({ code: 0, out: '' })
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({})
  })

  it('runs the call with what git has when the profiles cannot be read', async () => {
    const { git, calls } = fake(`remote.origin.url ${token.url}`)
    await withCredentials(git, async () => Promise.reject(new Error('the hub is away')), {})('/repos/five', ['fetch', 'origin'])
    expect(calls.at(-1)).toEqual({ args: ['fetch', 'origin'] })
  })
})

describe('credentialedRemote', () => {
  const recorded = () => {
    const calls: { args: string[]; env?: Readonly<Record<string, string>> }[] = []
    const git: RemoteGit = async (args, options) => {
      calls.push({ args, ...(options?.env === undefined ? {} : { env: options.env }) })
      return { code: 0, out: '' }
    }
    return { git, calls }
  }

  it('gives a clone of an HTTPS address the token of its profile, asked by the address without its user', async () => {
    const { git, calls } = recorded()
    const asked: (readonly string[])[] = []
    const remote = credentialedRemote(git, async (urls) => {
      asked.push(urls)
      return [token]
    }, {})
    await remote(['clone', '--progress', '--', 'https://john@github.com/john/repo.git', '/repos/six'], { timeoutMs: 5 })
    expect(asked).toEqual([['https://github.com/john/repo.git']])
    expect(calls[0]!.env).toMatchObject({ EVEN_KEEL_GIT_PASSWORD_0: 'ghp_example', 'GIT_CONFIG_KEY_1': `credential.${token.url}.helper` })
  })

  it('runs an SSH address, an address without a profile and a failed answer as they are', async () => {
    const { git, calls } = recorded()
    await credentialedRemote(git, async () => [token])(['ls-remote', '--', 'git@github.com:john/repo.git'])
    await credentialedRemote(git, async () => [])(['ls-remote', '--', token.url])
    await credentialedRemote(git, async () => Promise.reject(new Error('the hub is away')))(['ls-remote', '--', token.url])
    expect(calls.map((call) => call.env)).toEqual([undefined, undefined, undefined])
  })
})

describe('credentialEnv with git itself', () => {
  let root: string
  const run = (cwd: string, args: string[], env: Record<string, string>, input?: string) =>
    new Promise<{ code: number; out: string }>((resolve) => {
      const child = execFile('git', ['-C', cwd, ...args], { env: { ...isolated, ...env }, windowsHide: true }, (error, stdout, stderr) =>
        resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : -1, out: `${stdout}${stderr}` }),
      )
      // A command that reads no input (config --get) may exit before the write: EPIPE there is not a failure.
      child.stdin?.on('error', () => {})
      child.stdin?.end(input ?? '')
    })
  let isolated: NodeJS.ProcessEnv

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ek-credentials-'))
    await writeFile(join(root, 'global.gitconfig'), '')
    isolated = { ...process.env, GIT_CONFIG_GLOBAL: join(root, 'global.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
    for (const key of Object.keys(isolated)) if (key.startsWith('GIT_CONFIG_KEY_') || key.startsWith('GIT_CONFIG_VALUE_') || key === 'GIT_CONFIG_COUNT') delete isolated[key]
    await run(root, ['init', '-q', 'repo'], {})
    await run(root, ['init', '-q', '--bare', 'remote.git'], {})
  })
  afterAll(() => rm(root, { recursive: true, force: true }))

  it('answers git with the token for its remote only, and replaces a helper of the repository', async () => {
    const repo = join(root, 'repo')
    await run(repo, ['config', 'credential.helper', '!f() { echo username=someone; echo password=wrong; }; f'], {})
    const env = credentialEnv([token], {})
    const ours = await run(repo, ['credential', 'fill'], env, `url=${token.url}\n\n`)
    expect(ours.out).toContain('username=x-access-token')
    expect(ours.out).toContain('password=ghp_example')
    const other = await run(repo, ['credential', 'fill'], env, 'url=https://github.com/john/other.git\n\n')
    expect(other.out).toContain('password=wrong')
    expect(other.out).not.toContain('ghp_example')
  })

  it('keeps the variables of git config already in the environment before its own', async () => {
    const env = credentialEnv([token], { GIT_CONFIG_COUNT: '1' })
    expect(env.GIT_CONFIG_COUNT).toBe('4')
    expect(env.GIT_CONFIG_KEY_1).toBe('core.hooksPath')
    const read = await run(join(root, 'repo'), ['config', '--get', 'user.name'], { ...env, GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'John Doe' })
    expect(read.out.trim()).toBe('John Doe')
  })

  it('runs no hook of the repository in a credentialed call', async () => {
    const repo = join(root, 'repo')
    await mkdir(join(repo, 'hooks'), { recursive: true })
    await writeFile(join(repo, 'hooks', 'pre-push'), '#!/bin/sh\necho hook ran; exit 1\n')
    await chmod(join(repo, 'hooks', 'pre-push'), 0o755)
    await run(repo, ['config', 'core.hooksPath', 'hooks'], {})
    const identity = { GIT_AUTHOR_NAME: 'John Doe', GIT_AUTHOR_EMAIL: 'john@example.com', GIT_COMMITTER_NAME: 'John Doe', GIT_COMMITTER_EMAIL: 'john@example.com' }
    await run(repo, ['commit', '-q', '--allow-empty', '-m', 'one'], identity)
    const remote = join(root, 'remote.git')
    expect((await run(repo, ['push', remote, 'HEAD:refs/heads/main'], {})).code).not.toBe(0)
    const pushed = await run(repo, ['push', remote, 'HEAD:refs/heads/main'], credentialEnv([token], {}))
    expect(pushed.out).not.toContain('hook ran')
    expect(pushed.code).toBe(0)
  })
})
