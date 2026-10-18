import { describe, expect, it } from 'vitest'
import { checkoutRemotes, remoteRef } from './remotes.js'

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
