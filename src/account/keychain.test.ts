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

  interface Item {
    account: string | null
    text: string
  }

  const item = (text: string, account: string | null = 'm1'): Item => ({ account, text })

  /** The attribute dump of `find-generic-password` without `-w`; an account with a byte outside ASCII comes as hex. */
  function attributes(service: string, account: string | null): string {
    const acct = account === null ? '<NULL>' : /^[\x20-\x7e]*$/.test(account) ? `"${account}"` : `0x${Buffer.from(account).toString('hex').toUpperCase()}  "…"`
    return [
      'keychain: "/Users/m1/Library/Keychains/login.keychain-db"',
      'version: 512',
      'class: "genp"',
      'attributes:',
      `    0x00000007 <blob>="${service}"`,
      '    0x00000008 <blob>=<NULL>',
      `    "acct"<blob>=${acct}`,
      '    "cdat"<timedate>=0x32303236313130333132303030305A00  "20261103120000Z\\000"',
      `    "svce"<blob>="${service}"`,
      '',
    ].join('\n')
  }

  /** A fake `security` over a map of items: find and delete by `-s` and an optional `-a`, `-i` with one add line. */
  function keychainOf(items: Map<string, Item>, fails: { add?: boolean; timeout?: boolean } = {}) {
    const calls: { args: string[]; input?: string }[] = []
    const warn = vi.fn()
    const security: SecurityRun = (args, input) => {
      calls.push({ args, input })
      if (fails.timeout) return { status: null, stdout: '', timedOut: true }
      if (args[0] === '-i') {
        const line = /^add-generic-password -U(?: -a "([^"]*)")? -s "([^"]+)" -X "([0-9a-f]+)"\n$/.exec(input ?? '')
        if (line === null || fails.add) return { status: 1, stdout: '' }
        items.set(line[2]!, item(Buffer.from(line[3]!, 'hex').toString('utf8'), line[1] ?? null))
        return { status: 0, stdout: '' }
      }
      const service = args[args.indexOf('-s') + 1]!
      const found = items.get(service)
      const account = args.includes('-a') ? args[args.indexOf('-a') + 1] : undefined
      if (found === undefined || (account !== undefined && account !== found.account)) return { status: 44, stdout: '' }
      if (args[0] === 'delete-generic-password') {
        items.delete(service)
        return { status: 0, stdout: '' }
      }
      return { status: 0, stdout: args.includes('-w') ? found.text : attributes(service, found.account) }
    }
    return { calls, warn, keychain: new KeychainCredentials(security, warn) }
  }

  it('carries an item written under the macOS user name with that account, then deletes the old one (BTN-748)', () => {
    const items = new Map([[OLD, item(TEXT, 'm1')]])
    const { calls, keychain, warn } = keychainOf(items)
    keychain.move(OLD, NEW)
    expect([...items]).toEqual([[NEW, item(TEXT, 'm1')]])
    const write = calls.find((call) => call.args[0] === '-i')!
    expect(write.input).toBe(`add-generic-password -U -a "m1" -s "${NEW}" -X "${Buffer.from(TEXT).toString('hex')}"\n`)
    expect(calls.flatMap((call) => call.args).join(' ')).not.toContain('claudeAiOauth')
    expect(warn).not.toHaveBeenCalled()
  })

  it('decodes an account the dump gives as hex', () => {
    const items = new Map([[OLD, item(TEXT, 'josé')]])
    const { keychain } = keychainOf(items)
    keychain.move(OLD, NEW)
    expect([...items]).toEqual([[NEW, item(TEXT, 'josé')]])
  })

  it('carries an item without an account with no -a at all', () => {
    const items = new Map([[OLD, item(TEXT, null)]])
    const { calls, keychain } = keychainOf(items)
    keychain.move(OLD, NEW)
    expect([...items]).toEqual([[NEW, item(TEXT, null)]])
    expect(calls.some((call) => call.args.includes('-a'))).toBe(false)
  })

  it('leaves an item whose account cannot be quoted for security -i, and says so', () => {
    const items = new Map([[OLD, item(TEXT, 'a"b')]])
    const { calls, keychain, warn } = keychainOf(items)
    keychain.move(OLD, NEW)
    expect([...items]).toEqual([[OLD, item(TEXT, 'a"b')]])
    expect(calls.some((call) => call.args[0] === '-i')).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(OLD))
  })

  it('only deletes the old item when the new name already holds one, whatever its account', () => {
    const items = new Map([[OLD, item(TEXT, 'm1')], [NEW, item('newer', 'claude-code-user')]])
    const { calls, keychain } = keychainOf(items)
    keychain.move(OLD, NEW)
    expect([...items]).toEqual([[NEW, item('newer', 'claude-code-user')]])
    expect(calls.some((call) => call.args[0] === '-i')).toBe(false)
  })

  it('warns, not silently returns, without an old item', () => {
    const items = new Map([[NEW, item(TEXT)]])
    const { calls, keychain, warn } = keychainOf(items)
    keychain.move(OLD, NEW)
    expect([...items]).toEqual([[NEW, item(TEXT)]])
    expect(calls.every((call) => call.args[0] === 'find-generic-password')).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(OLD))
  })

  it('keeps the old item when the write fails', () => {
    const items = new Map([[OLD, item(TEXT)]])
    const { keychain, warn } = keychainOf(items, { add: true })
    keychain.move(OLD, NEW)
    expect([...items]).toEqual([[OLD, item(TEXT)]])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(NEW))
  })

  it('stops at a read that timed out', () => {
    const { calls, keychain } = keychainOf(new Map([[OLD, item(TEXT)]]), { timeout: true })
    keychain.move(OLD, NEW)
    expect(calls).toHaveLength(1)
  })

  it('forgets a kept answer, so the new name is read afresh', () => {
    const items = new Map([[OLD, item(TEXT)]])
    const { keychain } = keychainOf(items)
    expect(keychain.read(NEW, 0)).toBeUndefined()
    keychain.move(OLD, NEW)
    expect(keychain.read(NEW, 1)).toBe(TEXT)
  })
})
