import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Only presence and times survive parsing; no token text is retained. */
export interface OAuthShape {
  access: boolean
  refresh: boolean
  expiresAt: number | null
  refreshTokenExpiresAt: number | null
  mtimeMs: number
}

interface OAuthDetails {
  key: string
  version?: string | null
  pids?: number[] | null
  others?: string[]
}

export function parseOAuthShape(text: string, mtimeMs: number): OAuthShape | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || !('claudeAiOauth' in parsed)) return null
    const oauth = parsed.claudeAiOauth
    if (typeof oauth !== 'object' || oauth === null || !('accessToken' in oauth) || !('refreshToken' in oauth)) return null
    if (typeof oauth.accessToken !== 'string' || typeof oauth.refreshToken !== 'string') return null
    return {
      access: oauth.accessToken !== '',
      refresh: oauth.refreshToken !== '',
      expiresAt: timestamp('expiresAt' in oauth ? oauth.expiresAt : undefined),
      refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt' in oauth ? oauth.refreshTokenExpiresAt : undefined),
      mtimeMs,
    }
  } catch {
    return null
  }
}

export async function readOAuthShape(dir: string): Promise<OAuthShape | null> {
  try {
    const file = join(dir, '.credentials.json')
    const before = await stat(file)
    const text = await readFile(file, 'utf8')
    const after = await stat(file)
    // A write or replacement during the read is not a trustworthy transition.
    if (before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size || before.ino !== after.ino) return null
    return parseOAuthShape(text, after.mtimeMs)
  } catch {
    return null
  }
}

export function hasOAuthTokens(shape: OAuthShape): boolean {
  return shape.access || shape.refresh
}

export function otherOAuthFolders(known: ReadonlyMap<string, OAuthShape>, key: string, current: OAuthShape): string[] {
  return [...known].filter(([other, shape]) => other !== key && Math.abs(shape.mtimeMs - current.mtimeMs) <= 5000).map(([other]) => other).sort()
}

/** One line at most, with restoration taking precedence over an increased expiry. */
export function oauthTransition(previous: OAuthShape | undefined, current: OAuthShape, details: OAuthDetails): string | null {
  const prefix = `account: ${details.key}: `
  const at = date(current.mtimeMs)
  if (previous === undefined) return hasOAuthTokens(current) ? null : `${prefix}OAuth tokens empty since ${at}`
  if (hasOAuthTokens(previous) && !hasOAuthTokens(current)) {
    return `${prefix}the CLI emptied the OAuth tokens at ${at}; access expired at ${date(previous.expiresAt)}, refresh would expire at ${date(previous.refreshTokenExpiresAt)}; CLI ${details.version ?? 'unknown'}; live sessions: ${details.pids == null ? 'unknown' : details.pids.join(', ') || 'none'}; other folders changed within 5 s: ${details.others?.join(', ') || 'none'}`
  }
  if (!hasOAuthTokens(previous) && hasOAuthTokens(current)) return `${prefix}signed in again at ${at}`
  if (hasOAuthTokens(current) && previous.expiresAt !== null && current.expiresAt !== null && current.expiresAt > previous.expiresAt) {
    return `${prefix}tokens renewed at ${at}, access now expires at ${date(current.expiresAt)}`
  }
  return null
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(new Date(value).getTime()) ? value : null
}

function date(value: number | null): string {
  return value === null ? 'unknown' : new Date(value).toISOString()
}
