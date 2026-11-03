import { describe, expect, it, vi } from 'vitest'
import { KeychainCredentials, keychainService, type SecurityRun } from './keychain.js'

const TEXT = JSON.stringify({ claudeAiOauth: { expiresAt: 1, refreshTokenExpiresAt: 2 } })

function run(answer: ReturnType<SecurityRun>): SecurityRun & ReturnType<typeof vi.fn> {
  return vi.fn(() => answer)
}

describe('keychainService', () => {
  it('is the CLI default name without a config folder variable', () => {
    expect(keychainService(undefined)).toBe('Claude Code-credentials')
  })

  it('appends the first 8 hex of the sha256 of the folder path, as the CLI does', () => {
    expect(keychainService('/Users/john/.claude-accounts/john-example-com')).toBe('Claude Code-credentials-3afc1b0a')
  })

  it('hashes the NFC form of the path', () => {
    expect(keychainService('/Users/josé/.claude')).toBe(keychainService('/Users/josé/.claude'))
  })
})

describe('KeychainCredentials', () => {
  it('returns the stored text and asks security for that service only', () => {
    const security = run({ status: 0, stdout: `${TEXT}\n` })
    expect(new KeychainCredentials(security).read('Claude Code-credentials-12345678', 0)).toBe(TEXT)
    expect(security).toHaveBeenCalledWith(['find-generic-password', '-s', 'Claude Code-credentials-12345678', '-w'])
  })

  it('decodes a hex answer', () => {
    const security = run({ status: 0, stdout: Buffer.from(TEXT, 'utf8').toString('hex') })
    expect(new KeychainCredentials(security).read('s', 0)).toBe(TEXT)
  })

  it('reads nothing for a missing item', () => {
    expect(new KeychainCredentials(run({ status: 44, stdout: '' })).read('s', 0)).toBeUndefined()
  })

  it('keeps an answer for a minute', () => {
    const security = run({ status: 0, stdout: TEXT })
    const keychain = new KeychainCredentials(security)
    keychain.read('s', 0)
    keychain.read('s', 59_999)
    expect(security).toHaveBeenCalledTimes(1)
    keychain.read('s', 60_000)
    expect(security).toHaveBeenCalledTimes(2)
  })

  it('asks again after forget', () => {
    const security = run({ status: 0, stdout: TEXT })
    const keychain = new KeychainCredentials(security)
    keychain.read('s', 0)
    keychain.forget()
    keychain.read('s', 1)
    expect(security).toHaveBeenCalledTimes(2)
  })

  it('never asks again for an item whose read timed out: it may be waiting on an access dialog', () => {
    const security = run({ status: null, stdout: '', timedOut: true })
    const warn = vi.fn()
    const keychain = new KeychainCredentials(security, warn)
    expect(keychain.read('s', 0)).toBeUndefined()
    keychain.forget()
    expect(keychain.read('s', 10 * 60_000)).toBeUndefined()
    expect(security).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
