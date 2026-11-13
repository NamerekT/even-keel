import { describe, expect, it } from 'vitest'
import { notice } from '../../../src/notice/notice.js'
import { isRemoteRefusal, remoteRefusal, shortRemote } from './remoteRefusal.js'

describe('shortRemote', () => {
  it('keeps a short address whole', () => {
    expect(shortRemote('https://example.com/owner/storefront.git')).toBe('https://example.com/owner/storefront.git')
  })

  it('cuts a long one in the middle, keeping its host and its name', () => {
    const long = `https://git.example.com/${'group/'.repeat(20)}storefront.git`
    const short = shortRemote(long)
    expect(short.length).toBeLessThanOrEqual(48)
    expect(short.startsWith('https://git.example.com/')).toBe(true)
    expect(short.endsWith('/storefront.git')).toBe(true)
    expect(short).toContain('…')
  })
})

describe('remoteRefusal', () => {
  it("puts git's words apart from the line and cuts the address", () => {
    const remote = `https://git.example.com/${'group/'.repeat(20)}storefront.git`
    const { shown, detail } = remoteRefusal(notice('git.remoteFailed', { remote }, { detail: 'fatal: early EOF\n' }))
    expect(shown).toEqual({ code: 'git.remoteFailed', params: { remote: shortRemote(remote) } })
    expect(detail).toBe('fatal: early EOF')
  })

  it('has no detail where git said nothing', () => {
    expect(remoteRefusal(notice('git.remoteShape', {}))).toEqual({ shown: { code: 'git.remoteShape', params: {} }, detail: null })
  })
})

describe('isRemoteRefusal', () => {
  it('knows the refusals of a remote', () => {
    expect(isRemoteRefusal(notice('git.remoteShape', {}))).toBe(true)
    expect(isRemoteRefusal(notice('git.remoteDenied', { remote: 'x' }))).toBe(true)
    expect(isRemoteRefusal(notice('wizard.folderName', { value: 'x' }))).toBe(false)
  })
})
