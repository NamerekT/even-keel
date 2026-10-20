import { describe, expect, it } from 'vitest'
import { notice } from '../../../src/notice/notice.js'
import { profileAddOf, profileAddPath, pullFixOf, withoutProfileAdd } from './pullFix.js'

const noToken = notice('review.noToken', { remote: 'origin', kind: 'forgejo', web: 'https://git.example.com' })

describe('pullFixOf', () => {
  it('asks for a profile of the remote kind on its address when no profile has a token', () => {
    expect(pullFixOf(noToken)).toEqual({ fix: 'profile', kind: 'forgejo', web: 'https://git.example.com' })
  })

  it('asks for a remote when there is none', () => {
    expect(pullFixOf(notice('review.noRemote', { project: 'ABC' }))).toEqual({ fix: 'remote' })
  })

  it('reads the cause of a pause', () => {
    expect(pullFixOf(notice('review.notReady', { project: 'ABC' }, { cause: noToken }))).toMatchObject({ fix: 'profile' })
    expect(pullFixOf(notice('review.notOpened', { task: 'ABC-1' }, { cause: notice('review.noRemote', { project: 'ABC' }) }))).toEqual({ fix: 'remote' })
  })

  it('has nothing for a pull request refused or a host with no adapter', () => {
    expect(pullFixOf(notice('review.notOpened', { task: 'ABC-1' }, { cause: notice('review.denied', { ci: 'GitHub', status: 403 }) }))).toBeNull()
    expect(pullFixOf(notice('review.unsupportedHost', { remote: 'origin', host: 'gitlab.com' }))).toBeNull()
    expect(pullFixOf(notice('review.notReady', { project: 'ABC' }))).toBeNull()
    expect(pullFixOf(null)).toBeNull()
  })

  it('has nothing for a pause stored before the notice named the kind', () => {
    expect(pullFixOf({ code: 'review.noToken', params: { remote: 'origin' } } as never)).toBeNull()
  })
})

describe('profileAddPath', () => {
  it('round-trips through the search of /settings', () => {
    const path = profileAddPath('forgejo', 'https://git.example.com')
    const params = new URLSearchParams(path.slice(path.indexOf('?')))
    expect(path.startsWith('/settings?')).toBe(true)
    expect(profileAddOf(params)).toEqual({ kind: 'forgejo', host: 'https://git.example.com' })
    expect(profileAddOf(withoutProfileAdd(params))).toBeNull()
  })

  it('keeps the rest of the search', () => {
    expect(withoutProfileAdd(new URLSearchParams('profile=github&host=x&other=1')).toString()).toBe('other=1')
  })
})
