import { describe, expect, it } from 'vitest'
import { ciTargets, parseRemote, remoteKind, remotesOf } from './remote.js'

describe('remoteKind', () => {
  it('knows supported public hosts and configured GitLab hosts, leaving unknown ones to Forgejo', () => {
    expect(remoteKind('github.com')).toBe('github')
    expect(remoteKind('GitHub.com')).toBe('github')
    expect(remoteKind('gitlab.com')).toBe('gitlab')
    expect(remoteKind('bitbucket.org')).toBeNull()
    expect(remoteKind('git.example.com')).toBe('forgejo')
    expect(remoteKind('GIT.example.com', ['https://git.example.com/lab'])).toBe('gitlab')
  })
})

describe('parseRemote', () => {
  it('reads https, scp-like and ssh urls', () => {
    expect(parseRemote('https://forgejo.example.com/john/app.git')).toEqual({ host: 'forgejo.example.com', web: 'https://forgejo.example.com', owner: 'john', repo: 'app' })
    expect(parseRemote('git@github.com:octo-org/app.git')).toEqual({ host: 'github.com', web: 'https://github.com', owner: 'octo-org', repo: 'app' })
    expect(parseRemote('ssh://git@git.example.com:2222/john/app')).toEqual({ host: 'git.example.com', web: 'https://git.example.com', owner: 'john', repo: 'app' })
  })

  it('keeps the port and a path prefix of an https server', () => {
    expect(parseRemote('http://10.0.0.5:3000/git/john/app.git')).toEqual({ host: '10.0.0.5', web: 'http://10.0.0.5:3000/git', owner: 'john', repo: 'app' })
  })

  it('drops credentials from the url', () => {
    expect(parseRemote('https://john:secret@forgejo.example.com/john/app.git')?.web).toBe('https://forgejo.example.com')
  })

  it('refuses a local path', () => {
    expect(parseRemote('D:/backup/app.git')).toBeNull()
    expect(parseRemote('/srv/git/app.git')).toBeNull()
  })
})

describe('remotesOf', () => {
  it('reads the urls from git config', () => {
    const out = 'remote.origin.url https://forgejo.example.com/john/app.git\nremote.github.url https://github.com/octo-org/app.git'
    expect(remotesOf(out)).toEqual([
      { name: 'origin', url: 'https://forgejo.example.com/john/app.git' },
      { name: 'github', url: 'https://github.com/octo-org/app.git' },
    ])
  })
})

describe('ciTargets', () => {
  it('finds GitLab pipelines only with the root CI file and preserves subgroups for every transport', () => {
    const remotes = [
      { name: 'https', url: 'https://gitlab.com/group/subgroup/app.git' },
      { name: 'scp', url: 'git@gitlab.com:group/subgroup/app.git' },
      { name: 'ssh', url: 'ssh://git@gitlab.com:2222/group/subgroup/app.git' },
    ]
    expect(ciTargets(remotes, { forgejo: true, github: true })).toEqual([])
    expect(ciTargets(remotes, { forgejo: false, github: false, gitlab: true })).toEqual(
      remotes.map(({ name }) => ({ kind: 'gitlab', remote: name, web: 'https://gitlab.com', owner: 'group/subgroup', repo: 'app' })),
    )
  })

  it('uses GitLab profiles to distinguish self-managed hosts and their installation prefixes', () => {
    const remotes = [{ name: 'origin', url: 'http://git.example.com:8080/lab/group/sub/app.git' }]
    expect(ciTargets(remotes, { forgejo: true, github: false, gitlab: true }, ['http://git.example.com:8080/lab'])).toEqual([
      { kind: 'gitlab', remote: 'origin', web: 'http://git.example.com:8080/lab', owner: 'group/sub', repo: 'app' },
    ])
    expect(ciTargets(remotes, { forgejo: true, github: false, gitlab: true })[0]?.kind).toBe('forgejo')
  })

  it('reads SSH remotes of a prefixed GitLab installation without the web prefix in their path', () => {
    const remotes = [
      { name: 'scp', url: 'git@git.example.com:group/sub/app.git' },
      { name: 'ssh', url: 'ssh://git@git.example.com:2222/group/sub/app.git' },
    ]
    expect(ciTargets(remotes, { forgejo: false, github: false, gitlab: true }, ['https://git.example.com/lab'])).toEqual(
      remotes.map(({ name }) => ({ kind: 'gitlab', remote: name, web: 'https://git.example.com/lab', owner: 'group/sub', repo: 'app' })),
    )
  })
  const remotes = [
    { name: 'origin', url: 'https://forgejo.example.com/john/app.git' },
    { name: 'github', url: 'https://github.com/octo-org/app.git' },
  ]

  it('gives Forgejo its own workflows and GitHub the .github ones', () => {
    expect(ciTargets(remotes, { forgejo: true, github: true })).toEqual([
      { kind: 'forgejo', remote: 'origin', web: 'https://forgejo.example.com', owner: 'john', repo: 'app' },
      { kind: 'github', remote: 'github', web: 'https://github.com', owner: 'octo-org', repo: 'app' },
    ])
  })

  it('lets Forgejo run the .github workflows when it has none of its own', () => {
    expect(ciTargets(remotes, { forgejo: false, github: true }).map((target) => target.kind)).toEqual(['forgejo', 'github'])
  })

  it('has no GitHub Actions without .github workflows', () => {
    expect(ciTargets(remotes, { forgejo: true, github: false }).map((target) => target.kind)).toEqual(['forgejo'])
  })

  it('has no CI without workflows or remotes', () => {
    expect(ciTargets(remotes, { forgejo: false, github: false })).toEqual([])
    expect(ciTargets([], { forgejo: true, github: true })).toEqual([])
  })

  it('watches no CI on a host it has no adapter for', () => {
    const others = [
      { name: 'bucket', url: 'https://bitbucket.org/john/app.git' },
    ]
    expect(ciTargets(others, { forgejo: true, github: true })).toEqual([])
  })
})
