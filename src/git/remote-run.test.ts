import { describe, expect, it, vi } from 'vitest'
import { remoteEnv, remoteReader, type RemoteGit } from './remote-run.js'

describe('remoteEnv', () => {
  it('asks nobody and has git speak English, the words its refusals are read by', () => {
    expect(remoteEnv({ LANG: 'ru_RU.UTF-8', PATH: '/bin' })).toEqual({
      LANG: 'ru_RU.UTF-8',
      PATH: '/bin',
      LC_ALL: 'C',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
    })
  })
})

describe('remoteReader', () => {
  it('refuses a text that is no git address without asking git', async () => {
    const git = vi.fn<RemoteGit>()
    const read = remoteReader(git)
    expect(await read('a paragraph pasted by mistake')).toMatchObject({ code: 'git.remoteShape', params: {} })
    expect(git).not.toHaveBeenCalled()
  })

  it('asks git for an address', async () => {
    const git = vi.fn<RemoteGit>(async () => ({ code: 0, out: 'ref: refs/heads/trunk\tHEAD\nabc\trefs/heads/trunk' }))
    expect(await remoteReader(git)('https://example.com/owner/storefront.git')).toEqual({ head: 'trunk', branches: ['trunk'] })
  })
})
