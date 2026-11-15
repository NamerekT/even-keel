import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountHomes, type AccountHome } from './homes.js'
import { LONG_TOKEN_FILE, noteTokenRefused } from './longToken.js'
import { addTokenAccount, replaceToken, type TokenAccounts } from './tokenAccount.js'

const TOKEN = 'sk-ant-oat01-FAKE0000000000000000000000000000-example'
const NEXT = 'sk-ant-oat01-FAKE1111111111111111111111111111-example'
const NOW = new Date('2026-11-15T12:00:00.000Z')

const refusal = (code: string) => expect.objectContaining({ notice: expect.objectContaining({ code }) })
const tokenIn = (home: AccountHome) => JSON.parse(readFileSync(join(home.dir, 'settings.json'), 'utf8')).env.CLAUDE_CODE_OAUTH_TOKEN

describe('long-token accounts (BTN-1005)', () => {
  let root: string
  let homes: AccountHomes
  let checked: string[]
  let refused: Set<string>
  let accounts: TokenAccounts

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'even-keel-token-'))
    homes = new AccountHomes({ CLAUDE_CONFIG_DIR: join(root, 'no-global'), CODEX_HOME: join(root, 'no-codex') }, join(root, 'claude'), join(root, 'codex'), join(root, 'opencode'), join(root, 'copilot'))
    checked = []
    refused = new Set()
    accounts = {
      homes,
      now: () => NOW,
      check: async (home) => {
        const token = tokenIn(home)
        checked.push(token)
        if (refused.has(token)) throw new Error('401 authentication_failed')
      },
    }
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('adds a folder holding the token after one check turn, valid for a year', async () => {
    const home = await addTokenAccount(accounts, 'Spare', `  ${TOKEN}\n`)
    expect(home).toMatchObject({ key: 'spare', agent: 'claude', global: false })
    expect(checked).toEqual([TOKEN])
    expect(homes.longTokenOf(home)).toEqual({ until: '2027-11-15T12:00:00.000Z' })
  })

  it('names the folder "token" without a name', async () => {
    expect((await addTokenAccount(accounts, ' ', TOKEN)).key).toBe('token')
  })

  it('removes the folder again when the check turn is refused', async () => {
    refused.add(TOKEN)
    await expect(addTokenAccount(accounts, 'Spare', TOKEN)).rejects.toThrow(refusal('account.tokenRejected'))
    expect(existsSync(join(root, 'claude', 'spare'))).toBe(false)
    expect(homes.list().some((home) => home.key === 'spare')).toBe(false)
  })

  it('refuses anything that is not a long token before a folder is made', async () => {
    await expect(addTokenAccount(accounts, 'Spare', 'sk-ant-api03-FAKE0000000000000000000000000000-example')).rejects.toThrow(refusal('account.tokenInvalid'))
    expect(checked).toEqual([])
    expect(existsSync(join(root, 'claude', 'spare'))).toBe(false)
  })

  it('keeps the folder with a full sign-in the token is said to be of', async () => {
    mkdirSync(join(root, 'claude', 'main'), { recursive: true })
    const home = await addTokenAccount(accounts, 'Spare', TOKEN, 'main')
    expect(homes.longTokenOf(home)).toEqual({ until: '2027-11-15T12:00:00.000Z', sameAs: 'main' })
  })

  it('refuses an unknown folder or a token folder as the same account', async () => {
    await expect(addTokenAccount(accounts, 'Spare', TOKEN, 'nowhere')).rejects.toThrow(refusal('account.unknown'))
    const first = await addTokenAccount(accounts, 'First', TOKEN)
    await expect(addTokenAccount(accounts, 'Spare', NEXT, first.key)).rejects.toThrow(refusal('account.unknown'))
    expect(checked).toEqual([TOKEN])
    expect(existsSync(join(root, 'claude', 'spare'))).toBe(false)
  })

  it('replaces the token, clearing the refusal and keeping the same account', async () => {
    mkdirSync(join(root, 'claude', 'main'), { recursive: true })
    const home = await addTokenAccount(accounts, 'Spare', TOKEN, 'main')
    noteTokenRefused(home.dir, '2026-12-01T00:00:00.000Z')
    accounts.now = () => new Date('2026-12-02T12:00:00.000Z')
    await replaceToken(accounts, home, NEXT)
    expect(tokenIn(home)).toBe(NEXT)
    expect(homes.longTokenOf(home)).toEqual({ until: '2027-12-02T12:00:00.000Z', sameAs: 'main' })
  })

  it('puts the old token and its file back when the new one is refused', async () => {
    const home = await addTokenAccount(accounts, 'Spare', TOKEN)
    noteTokenRefused(home.dir, '2026-12-01T00:00:00.000Z')
    const kept = readFileSync(join(home.dir, LONG_TOKEN_FILE), 'utf8')
    refused.add(NEXT)
    accounts.now = () => new Date('2026-12-02T12:00:00.000Z')
    await expect(replaceToken(accounts, home, NEXT)).rejects.toThrow(refusal('account.tokenRejected'))
    expect(tokenIn(home)).toBe(TOKEN)
    expect(readFileSync(join(home.dir, LONG_TOKEN_FILE), 'utf8')).toBe(kept)
  })

  it('refuses a new token for a folder that holds none', async () => {
    mkdirSync(join(root, 'claude', 'main'), { recursive: true })
    await expect(replaceToken(accounts, homes.find('main')!, NEXT)).rejects.toThrow(refusal('account.keyNotHeld'))
  })
})
