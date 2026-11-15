import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from '../notice/notice.js'
import type { LongToken } from './model.js'
import { OAUTH_TOKEN_VARIABLE } from './share.js'

/** What Even Keel knows of a folder's long token beside the token itself; kept in the account folder, never in git. */
export const LONG_TOKEN_FILE = 'even-keel-token.json'
/** `claude setup-token` issues a token for a year and the token carries no readable date: counted from the day it was added. */
const VALID_MS = 365 * 24 * 3600_000
const TOKEN = /^sk-ant-oat\d\d-\S{20,}$/

export type { LongToken }

/** The trimmed token of the form `claude setup-token` prints; an API key or anything else is refused. */
export function assertLongToken(token: string): string {
  const value = token.trim()
  if (!TOKEN.test(value)) throw fail('account.tokenInvalid', {})
  return value
}

function readObject(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function tokenIn(dir: string): string | null {
  const env = readObject(join(dir, 'settings.json')).env
  const token = typeof env === 'object' && env !== null ? (env as Record<string, unknown>)[OAUTH_TOKEN_VARIABLE] : undefined
  return typeof token === 'string' && token !== '' ? token : null
}

/** The folder's long token as Even Keel knows it; null — its `settings.json` holds none. */
export function readLongToken(dir: string): LongToken | null {
  if (tokenIn(dir) === null) return null
  const kept = readObject(join(dir, LONG_TOKEN_FILE))
  return {
    until: typeof kept.until === 'string' ? kept.until : null,
    ...(typeof kept.sameAs === 'string' && kept.sameAs !== '' && { sameAs: kept.sameAs }),
    ...(typeof kept.refusedAt === 'string' && { refusedAt: kept.refusedAt }),
  }
}

/** The token into the folder's `settings.json`, the rest of the file as it was, and a year from `now` as its last day. */
export function writeLongToken(dir: string, token: string, now: Date, sameAs?: string): void {
  const file = join(dir, 'settings.json')
  const settings = readObject(file)
  const env = typeof settings.env === 'object' && settings.env !== null ? (settings.env as Record<string, unknown>) : {}
  writeFileSync(file, JSON.stringify({ ...settings, env: { ...env, [OAUTH_TOKEN_VARIABLE]: token } }, null, 2))
  const kept: LongToken = { until: new Date(now.getTime() + VALID_MS).toISOString(), ...(sameAs !== undefined && { sameAs }) }
  writeFileSync(join(dir, LONG_TOKEN_FILE), JSON.stringify(kept, null, 2))
}

/** Puts back what `takeLongToken` returned, after a new token failed its check. */
export function restoreLongToken(dir: string, held: HeldToken): void {
  const file = join(dir, 'settings.json')
  const settings = readObject(file)
  const env = typeof settings.env === 'object' && settings.env !== null ? (settings.env as Record<string, unknown>) : {}
  writeFileSync(file, JSON.stringify({ ...settings, env: { ...env, [OAUTH_TOKEN_VARIABLE]: held.token } }, null, 2))
  if (held.kept === null) rmSync(join(dir, LONG_TOKEN_FILE), { force: true })
  else writeFileSync(join(dir, LONG_TOKEN_FILE), held.kept)
}

export interface HeldToken {
  token: string
  kept: string | null
}

/** The folder's token and its file as they are, to put back; null — the folder holds no token. */
export function takeLongToken(dir: string): HeldToken | null {
  const token = tokenIn(dir)
  if (token === null) return null
  try {
    return { token, kept: readFileSync(join(dir, LONG_TOKEN_FILE), 'utf8') }
  } catch {
    return { token, kept: null }
  }
}

/** Notes that the provider refused the folder's token; false — already noted or no token there. */
export function noteTokenRefused(dir: string, at: string): boolean {
  const known = readLongToken(dir)
  if (known === null || known.refusedAt !== undefined) return false
  writeFileSync(join(dir, LONG_TOKEN_FILE), JSON.stringify({ ...known, refusedAt: at }, null, 2))
  return true
}

/** The token no longer signs the folder in: refused by the provider, or past its last day. */
export function tokenOver(token: LongToken, now: Date): boolean {
  return token.refusedAt !== undefined || (token.until !== null && Date.parse(token.until) <= now.getTime())
}
