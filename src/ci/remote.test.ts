import { describe, expect, it } from 'vitest'
import { ciTargets, parseRemote, remoteKind, remotesOf } from './remote.js'

describe('remoteKind', () => {
  it('knows GitHub and the public hosts it has no adapter for, and takes any other for Forgejo', () => {
    expect(remoteKind('github.com')).toBe('github')
    expect(remoteKind('GitHub.com')).toBe('github')
    expect(remoteKind('gitlab.com')).toBeNull()
    expect(remoteKind('bitbucket.org')).toBeNull()
    expect(remoteKind('git.example.com')).toBe('forgejo')
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
      { name: 'lab', url: 'git@gitlab.com:john/app.git' },
      { name: 'bucket', url: 'https://bitbucket.org/john/app.git' },
    ]
    expect(ciTargets(others, { forgejo: true, github: true })).toEqual([])
  })
})
