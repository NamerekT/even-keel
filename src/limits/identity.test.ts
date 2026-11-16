import { describe, expect, it } from 'vitest'
import { AccountIdentities, claudeAccountOf } from './identity.js'

describe('claudeAccountOf', () => {
  it('reads the account a folder is signed in as from its oauthAccount', () => {
    const text = JSON.stringify({ oauthAccount: { accountUuid: '00000000-0000-4000-8000-000000000001', emailAddress: 'john@example.com' }, projects: {} })
    expect(claudeAccountOf(text)).toEqual({ account: '00000000-0000-4000-8000-000000000001', email: 'john@example.com' })
  })

  it('knows no account without a sign-in or with a file it cannot read', () => {
    expect(claudeAccountOf(JSON.stringify({ projects: {} }))).toBeUndefined()
    expect(claudeAccountOf(JSON.stringify({ oauthAccount: { emailAddress: 'john@example.com' } }))).toBeUndefined()
    expect(claudeAccountOf('{ not json')).toBeUndefined()
    expect(claudeAccountOf(JSON.stringify({ oauthAccount: { accountUuid: 'a' } }))).toEqual({ account: 'a', email: null })
  })
})

describe('AccountIdentities', () => {
  it('reads a file again only once its answer is older than the interval', () => {
    let now = 0
    const reads: string[] = []
    const texts: Record<string, string> = { '/a/.claude.json': JSON.stringify({ oauthAccount: { accountUuid: 'a' } }) }
    const identities = new AccountIdentities({
      read: (file) => {
        reads.push(file)
        return texts[file]
      },
      intervalMs: 30_000,
      now: () => now,
    })
    expect(identities.of('/a/.claude.json')?.account).toBe('a')
    texts['/a/.claude.json'] = JSON.stringify({ oauthAccount: { accountUuid: 'b' } })
    now = 29_000
    expect(identities.of('/a/.claude.json')?.account).toBe('a')
    now = 31_000
    expect(identities.of('/a/.claude.json')?.account).toBe('b')
    expect(identities.of('/missing/.claude.json')).toBeUndefined()
    expect(reads).toEqual(['/a/.claude.json', '/a/.claude.json', '/missing/.claude.json'])
  })
})
