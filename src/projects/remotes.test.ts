import { describe, expect, it } from 'vitest'
import { checkoutRemotes, ProjectRemotes, remotePeers, remoteRef, repositoryIds, sameRepository } from './remotes.js'

describe('remotePeers', () => {
  const ref = (id: string) => ({ id, path: id.split('/').slice(-2).join('/') })
  const view = {
    TSK: [ref('git.example.com/acme/demo')],
    DT: [ref('git.example.com/acme/demo'), ref('github.com/acme/demo')],
    NAM: [ref('github.com/acme/demo')],
    REL: [ref('git.example.com/acme/demo')],
    OTHER: [ref('git.example.com/acme/other')],
    NONE: [],
  }
  const branchOf = (project: string) => (project === 'REL' ? 'release/v1' : 'main')

  it('takes the projects with a remote in common and the same main branch', () => {
    expect(remotePeers(view, branchOf, 'TSK')).toEqual(['DT'])
    expect(remotePeers(view, branchOf, 'DT')).toEqual(['TSK', 'NAM'])
    expect(remotePeers(view, branchOf, 'REL')).toEqual([])
    expect(remotePeers(view, branchOf, 'OTHER')).toEqual([])
    expect(remotePeers(view, branchOf, 'NONE')).toEqual([])
    expect(remotePeers(view, branchOf, 'GONE')).toEqual([])
  })
})

describe('remoteRef', () => {
  const ref = (url: string) => remoteRef(url, 'D:\\work\\app', 'win32')

  it('takes the host and the path of a server remote', () => {
    expect(ref('https://forgejo.example.com/john/app.git')).toEqual({ id: 'forgejo.example.com/john/app', path: 'john/app' })
    expect(ref('git@forgejo.example.com:john/app.git')).toEqual({ id: 'forgejo.example.com/john/app', path: 'john/app' })
    expect(ref('ssh://git@forgejo.example.com:2222/john/app/')).toEqual({ id: 'forgejo.example.com/john/app', path: 'john/app' })
  })

  it('drops credentials, the port and the case', () => {
    expect(ref('https://john:secret@Forgejo.Example.com:3000/John/App.git')).toEqual({ id: 'forgejo.example.com/john/app', path: 'John/App' })
  })

  it('names a server repository by its last two parts', () => {
    expect(ref('http://10.0.0.5:3000/git/john/app.git')).toEqual({ id: '10.0.0.5/git/john/app', path: 'john/app' })
  })

  it('takes a local remote by its resolved path and names it by its folder', () => {
    expect(ref('D:/Backup/app.git')).toEqual({ id: 'd:\\backup\\app.git', path: 'app' })
    expect(ref('D:\\Backup\\app.git\\')).toEqual({ id: 'd:\\backup\\app.git', path: 'app' })
    expect(ref('file:///D:/Backup/app.git')).toEqual({ id: 'd:\\backup\\app.git', path: 'app' })
    expect(ref('../bare/app.git')).toEqual({ id: 'd:\\work\\bare\\app.git', path: 'app' })
    expect(remoteRef('/srv/git/app.git', '/home/john/app', 'linux')).toEqual({ id: '/srv/git/app.git', path: 'app' })
  })

  it('refuses an empty url', () => {
    expect(ref('')).toBeNull()
    expect(ref('https://')).toBeNull()
  })
})

describe('checkoutRemotes', () => {
  it('gives each repository once whatever its remotes are called', async () => {
    const out = 'remote.origin.url https://forgejo.example.com/john/app.git\nremote.forgejo.url git@forgejo.example.com:john/app\nremote.github.url https://github.com/octo-org/app.git\n'
    const refs = await checkoutRemotes(async () => ({ code: 0, out }), 'D:\\work\\app')
    expect(refs).toEqual([
      { id: 'forgejo.example.com/john/app', path: 'john/app' },
      { id: 'github.com/octo-org/app', path: 'octo-org/app' },
    ])
  })

  it('has none when git cannot read the folder', async () => {
    expect(await checkoutRemotes(async () => ({ code: 1, out: '' }), 'D:\\gone')).toEqual([])
  })
})

describe('sameRepository', () => {
  const ids = (repo: string, ...urls: string[]) =>
    repositoryIds(urls.map((url) => remoteRef(url, repo, 'win32')!), repo, 'win32')

  it('takes a remote in common, however each checkout names it', () => {
    expect(sameRepository(ids('D:\\work\\app', 'https://github.com/octo-org/app.git'), ids('D:\\work\\app-release', 'git@github.com:Octo-Org/app'))).toBe(true)
  })

  it('takes a clone of the other checkout, either way round', () => {
    const main = ids('D:\\work\\app')
    const clone = ids('D:\\work\\app-release', '../App')
    expect(sameRepository(clone, main)).toBe(true)
    expect(sameRepository(main, clone)).toBe(true)
  })

  it('refuses checkouts of other repositories', () => {
    expect(sameRepository(ids('D:\\work\\app', 'https://github.com/octo-org/app.git'), ids('D:\\work\\shop', 'https://github.com/octo-org/shop.git'))).toBe(false)
    expect(sameRepository(ids('D:\\work\\app'), ids('D:\\work\\shop'))).toBe(false)
  })
})

describe('ProjectRemotes', () => {
  it('keeps what makes each project one repository with another', async () => {
    const remotes = new ProjectRemotes(async () => ({ code: 0, out: 'remote.origin.url https://github.com/octo-org/app.git\n' }))
    await remotes.apply({ ABC: 'D:\\work\\app' })
    expect(remotes.repositories.ABC).toEqual(repositoryIds([{ id: 'github.com/octo-org/app', path: 'octo-org/app' }], 'D:\\work\\app'))
  })

  it('keeps the remotes of each project by name and address, and tells a remote added by hand', async () => {
    let out = ''
    const remotes = new ProjectRemotes(async () => ({ code: 0, out }))
    expect(remotes.urls.ABC).toBeUndefined()
    await remotes.apply({ ABC: 'D:\\work\\app' })
    expect(remotes.urls.ABC).toEqual([])

    out = 'remote.origin.url https://github.com/octo-org/app.git\n'
    expect(await remotes.apply({ ABC: 'D:\\work\\app' })).toBe(true)
    expect(remotes.urls.ABC).toEqual([{ name: 'origin', url: 'https://github.com/octo-org/app.git' }])
    expect(await remotes.apply({ ABC: 'D:\\work\\app' })).toBe(false)
  })
})
