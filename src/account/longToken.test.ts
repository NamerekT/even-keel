import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertLongToken, heldLongToken, LONG_TOKEN_FILE, noteTokenRefused, readLongToken, restoreLongToken, takeLongToken, tokenOver, writeLongToken } from './longToken.js'

const TOKEN = 'sk-ant-oat01-fake-fake-fake-fake-fake'
const NOW = new Date('2026-11-15T10:00:00.000Z')

describe('a long token of an account folder', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-token-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const settings = () => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))

  it('takes only what setup-token prints', () => {
    expect(assertLongToken(`  ${TOKEN}\n`)).toBe(TOKEN)
    for (const wrong of ['', 'sk-ant-api03-fake-fake-fake-fake-fake', 'sk-ant-oat01-short', `${TOKEN} tail`]) {
      expect(() => assertLongToken(wrong)).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'account.tokenInvalid' }) }))
    }
  })

  it('keeps the token in settings.json, a year ahead and the folder of the same account next to it', () => {
    expect(readLongToken(dir)).toBeNull()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ model: 'opus', env: { OTHER: '1' } }))
    writeLongToken(dir, TOKEN, NOW, { sameAs: 'full' })
    expect(settings()).toEqual({ model: 'opus', env: { OTHER: '1', CLAUDE_CODE_OAUTH_TOKEN: TOKEN } })
    expect(readLongToken(dir)).toEqual({ until: '2027-11-15T10:00:00.000Z', sameAs: 'full' })
  })

  it('keeps the account it was said to be of, and drops a malformed one', () => {
    writeLongToken(dir, TOKEN, NOW, { account: { account: 'uuid-1', email: null } })
    expect(readLongToken(dir)).toEqual({ until: '2027-11-15T10:00:00.000Z', account: { account: 'uuid-1', email: null } })
    writeFileSync(join(dir, LONG_TOKEN_FILE), JSON.stringify({ until: null, account: { email: 'john.doe@example.com' } }))
    expect(readLongToken(dir)).toEqual({ until: null })
  })

  it('reads a folder set up by hand as a token with no known last day', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN } }))
    expect(readLongToken(dir)).toEqual({ until: null })
    expect(tokenOver({ until: null }, NOW)).toBe(false)
  })

  it('gives the token itself with whom it was said to be of, for a machine on the same one (BTN-1501)', () => {
    expect(heldLongToken(dir)).toBeNull()
    writeLongToken(dir, TOKEN, NOW, { sameAs: 'full', account: { account: 'uuid-1', email: null } })
    expect(heldLongToken(dir)).toEqual({ token: TOKEN, sameAs: 'full', account: { account: 'uuid-1', email: null } })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN } }))
    rmSync(join(dir, LONG_TOKEN_FILE))
    expect(heldLongToken(dir)).toEqual({ token: TOKEN })
  })

  it('is over once refused or past its last day, and a new token starts over', () => {
    writeLongToken(dir, TOKEN, NOW)
    expect(tokenOver(readLongToken(dir)!, NOW)).toBe(false)
    expect(tokenOver(readLongToken(dir)!, new Date('2027-11-15T10:00:00.000Z'))).toBe(true)
    expect(noteTokenRefused(dir, '2026-12-01T00:00:00.000Z')).toBe(true)
    expect(noteTokenRefused(dir, '2026-12-02T00:00:00.000Z')).toBe(false)
    expect(readLongToken(dir)).toMatchObject({ refusedAt: '2026-12-01T00:00:00.000Z' })
    expect(tokenOver(readLongToken(dir)!, NOW)).toBe(true)
    writeLongToken(dir, `${TOKEN}-new`, NOW)
    expect(readLongToken(dir)).toEqual({ until: '2027-11-15T10:00:00.000Z' })
  })

  it('puts the old token and its file back after a new one failed', () => {
    writeLongToken(dir, TOKEN, NOW, { sameAs: 'full' })
    const held = takeLongToken(dir)!
    writeLongToken(dir, `${TOKEN}-new`, new Date('2026-12-01T00:00:00.000Z'))
    restoreLongToken(dir, held)
    expect(settings().env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN)
    expect(readLongToken(dir)).toEqual({ until: '2027-11-15T10:00:00.000Z', sameAs: 'full' })
    expect(readFileSync(join(dir, LONG_TOKEN_FILE), 'utf8')).toBe(held.kept)
  })

  it('notes no refusal in a folder without a token', () => {
    expect(noteTokenRefused(dir, NOW.toISOString())).toBe(false)
    expect(takeLongToken(dir)).toBeNull()
  })
})
