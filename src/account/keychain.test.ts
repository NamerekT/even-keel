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

describe('KeychainCredentials.move', () => {
  const OLD = 'Claude Code-credentials-11111111'
  const NEW = 'Claude Code-credentials-22222222'

  /** A fake `security` over a map of items: find, delete and `-i` with one `add-generic-password` line. */
  function keychainOf(items: Map<string, string>, fails: { add?: boolean; timeout?: boolean } = {}) {
    const calls: { args: string[]; input?: string }[] = []
    const security: SecurityRun = (args, input) => {
      calls.push({ args, input })
      if (fails.timeout) return { status: null, stdout: '', timedOut: true }
      if (args[0] === '-i') {
        const line = /^add-generic-password -U -a "claude-code-user" -s "([^"]+)" -X "([0-9a-f]+)"\n$/.exec(input ?? '')
        if (line === null || fails.add) return { status: 1, stdout: '' }
        items.set(line[1]!, Buffer.from(line[2]!, 'hex').toString('utf8'))
        return { status: 0, stdout: '' }
      }
      const service = args[args.indexOf('-s') + 1]!
      if (!items.has(service)) return { status: 44, stdout: '' }
      if (args[0] === 'delete-generic-password') {
        items.delete(service)
        return { status: 0, stdout: '' }
      }
      return { status: 0, stdout: args.includes('-w') ? items.get(service)! : '' }
    }
    return { calls, keychain: new KeychainCredentials(security, vi.fn()) }
  }

  it('writes the old item under the new name as the CLI does, then deletes the old one', () => {
    const items = new Map([[OLD, TEXT]])
    const { calls, keychain } = keychainOf(items)
    keychain.move(OLD, NEW)
    expect([...items]).toEqual([[NEW, TEXT]])
    const write = calls.find((call) => call.args[0] === '-i')!
    expect(write.input).toBe(`add-generic-password -U -a "claude-code-user" -s "${NEW}" -X "${Buffer.from(TEXT).toString('hex')}"\n`)
    expect(calls.flatMap((call) => call.args).join(' ')).not.toContain('claudeAiOauth')
  })

  it('only deletes the old item when the new name already holds one', () => {
    const items = new Map([[OLD, TEXT], [NEW, 'newer']])
    const { calls, keychain } = keychainOf(items)
    keychain.move(OLD, NEW)
    expect([...items]).toEqual([[NEW, 'newer']])
    expect(calls.some((call) => call.args[0] === '-i')).toBe(false)
  })

  it('does nothing without an old item', () => {
    const items = new Map([[NEW, TEXT]])
    const { calls, keychain } = keychainOf(items)
    keychain.move(OLD, NEW)
    expect([...items]).toEqual([[NEW, TEXT]])
    expect(calls.every((call) => call.args[0] === 'find-generic-password')).toBe(true)
  })

  it('keeps the old item when the write fails', () => {
    const items = new Map([[OLD, TEXT]])
    const { keychain } = keychainOf(items, { add: true })
    keychain.move(OLD, NEW)
    expect([...items]).toEqual([[OLD, TEXT]])
  })

  it('stops at a read that timed out', () => {
    const { calls, keychain } = keychainOf(new Map([[OLD, TEXT]]), { timeout: true })
    keychain.move(OLD, NEW)
    expect(calls).toHaveLength(1)
  })

  it('forgets a kept answer, so the new name is read afresh', () => {
    const items = new Map([[OLD, TEXT]])
    const { keychain } = keychainOf(items)
    expect(keychain.read(NEW, 0)).toBeUndefined()
    keychain.move(OLD, NEW)
    expect(keychain.read(NEW, 1)).toBe(TEXT)
  })
})
