import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { otherOAuthFolders, oauthTransition, parseOAuthShape, readOAuthShape, type OAuthShape } from './oauth.js'

vi.mock('node:fs/promises', async (original) => {
  const files = await original<typeof import('node:fs/promises')>()
  return { ...files, readFile: vi.fn(files.readFile) }
})

const at = Date.parse('2026-11-06T10:39:42.123Z')
const accessExpiry = at - 1000
const refreshExpiry = at + 20 * 86400_000
const full: OAuthShape = { access: true, refresh: true, expiresAt: accessExpiry, refreshTokenExpiresAt: refreshExpiry, mtimeMs: at }
const empty: OAuthShape = { ...full, access: false, refresh: false, expiresAt: 0, mtimeMs: at + 1000 }
const details = { key: 'test', version: '2.1.317', pids: [123, 456], others: ['global', 'spare'] }
const raw = (accessToken = 'fake-access-secret', refreshToken = 'fake-refresh-secret') => JSON.stringify({
  claudeAiOauth: { accessToken, refreshToken, expiresAt: accessExpiry, refreshTokenExpiresAt: refreshExpiry },
})

describe('OAuth transition diagnostics', () => {
  it('takes the first nonempty reading as a baseline', () => {
    expect(oauthTransition(undefined, full, details)).toBeNull()
  })

  it('reports an already empty first reading at the file time', () => {
    expect(oauthTransition(undefined, empty, details)).toBe('account: test: OAuth tokens empty since 2026-11-06T10:39:43.123Z')
  })

  it('reports emptying with the previous lifetimes and diagnostic context', () => {
    expect(oauthTransition(full, empty, details)).toBe(
      `account: test: the CLI emptied the OAuth tokens at 2026-11-06T10:39:43.123Z; access expired at ${new Date(accessExpiry).toISOString()}, refresh would expire at ${new Date(refreshExpiry).toISOString()}; CLI 2.1.317; live sessions: 123, 456; other folders changed within 5 s: global, spare`,
    )
  })

  it('reports a later expiry as renewal', () => {
    expect(oauthTransition(full, { ...full, expiresAt: at + 60_000 }, details)).toBe(
      'account: test: tokens renewed at 2026-11-06T10:39:42.123Z, access now expires at 2026-11-06T10:40:42.123Z',
    )
  })

  it('reports sign-in rather than renewal when tokens return', () => {
    expect(oauthTransition(empty, full, details)).toBe('account: test: signed in again at 2026-11-06T10:39:42.123Z')
  })

  it('does not repeat a shape, even if the file time changes', () => {
    for (const shape of [full, empty]) {
      expect(oauthTransition(shape, shape, details)).toBeNull()
      expect(oauthTransition(shape, { ...shape, mtimeMs: at + 50_000 }, details)).toBeNull()
    }
  })

  it('does not report renewal for a backwards or unknown expiry, or empty tokens', () => {
    expect(oauthTransition(full, { ...full, expiresAt: 0 }, details)).toBeNull()
    expect(oauthTransition({ ...full, expiresAt: null }, full, details)).toBeNull()
    expect(oauthTransition(empty, { ...empty, expiresAt: at }, details)).toBeNull()
  })

  it('counts a partial pair as present and fills missing metadata safely', () => {
    const partial = { ...full, access: false, expiresAt: null, refreshTokenExpiresAt: null }
    expect(oauthTransition(full, partial, details)).toBeNull()
    expect(oauthTransition(partial, empty, { key: 'test' })).toContain('access expired at unknown, refresh would expire at unknown; CLI unknown; live sessions: unknown; other folders changed within 5 s: none')
    expect(oauthTransition(empty, partial, details)).toContain('signed in again')
    expect(oauthTransition(full, empty, { ...details, pids: [], others: [] })).toContain('live sessions: none; other folders changed within 5 s: none')
  })

  it('only correlates other known folders at most five seconds apart', () => {
    const known = new Map([
      ['test', full], ['global', { ...full, mtimeMs: at - 5000 }],
      ['spare', { ...full, mtimeMs: at + 5000 }], ['old', { ...full, mtimeMs: at - 5001 }],
      ['newer', { ...full, mtimeMs: at + 5001 }],
    ])
    expect(otherOAuthFolders(known, 'test', full)).toEqual(['global', 'spare'])
  })

  it('drops token values before keeping a shape or forming any line', () => {
    const shape = parseOAuthShape(raw(), at)!
    expect(shape).toEqual(full)
    const lines = [oauthTransition(shape, empty, details), oauthTransition(empty, shape, details), oauthTransition(undefined, shape, details)]
    for (const secret of ['fake-access-secret', 'fake-refresh-secret']) {
      expect(JSON.stringify({ shape, lines })).not.toContain(secret)
    }
  })

  it.each(['', '{', 'null', '[]', '{}', '{"claudeAiOauth":null}', '{"claudeAiOauth":{}}',
    '{"claudeAiOauth":{"accessToken":"","refreshToken":null}}',
    '{"claudeAiOauth":{"accessToken":""}}',
  ])('skips absent OAuth and malformed or incomplete JSON: %s', (text) => {
    expect(parseOAuthShape(text, at)).toBeNull()
  })

  it('keeps unknown and out-of-range dates out of the log', () => {
    const shape = parseOAuthShape(JSON.stringify({ claudeAiOauth: {
      accessToken: '', refreshToken: '', expiresAt: 'fake-date-secret', refreshTokenExpiresAt: 1e100,
    } }), at)!
    expect(shape).toEqual({ ...empty, expiresAt: null, refreshTokenExpiresAt: null, mtimeMs: at })
    expect(oauthTransition(shape, full, details)).toContain('signed in again')
  })
})

describe('readOAuthShape', () => {
  const dirs: string[] = []
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('reads the credentials file mtime without changing its contents', async () => {
    await mkdir('.temp', { recursive: true })
    const dir = await mkdtemp(join('.temp', 'oauth-'))
    dirs.push(dir)
    const file = join(dir, '.credentials.json')
    expect(await readOAuthShape(dir)).toBeNull()
    await writeFile(file, raw())
    await utimes(file, new Date(at), new Date(at))
    const shape = await readOAuthShape(dir)
    expect(shape).toEqual({ ...full, mtimeMs: expect.closeTo(at, 0) })
    expect(await readFile(file, 'utf8')).toBe(raw())
    await writeFile(file, '{')
    expect(await readOAuthShape(dir)).toBeNull()
  })

  it('skips a valid JSON reading if the file changed while it was being read', async () => {
    await mkdir('.temp', { recursive: true })
    const dir = await mkdtemp(join('.temp', 'oauth-'))
    dirs.push(dir)
    const file = join(dir, '.credentials.json')
    await writeFile(file, raw())
    await utimes(file, new Date(at), new Date(at))
    vi.mocked(readFile).mockImplementationOnce(async () => {
      await utimes(file, new Date(at + 1000), new Date(at + 1000))
      return raw()
    })
    expect(await readOAuthShape(dir)).toBeNull()
    expect(await readOAuthShape(dir)).toMatchObject({ access: true, refresh: true })
  })
})
