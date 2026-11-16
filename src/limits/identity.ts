import { readFileSync } from 'node:fs'

/** The claude.ai account a Claude folder is signed in as (`oauthAccount` of its `.claude.json`). */
export interface ClaudeAccount {
  account: string
  email: string | null
}

export function claudeAccountOf(text: string): ClaudeAccount | undefined {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return undefined
  }
  const oauth = (body as { oauthAccount?: unknown } | null)?.oauthAccount
  if (typeof oauth !== 'object' || oauth === null) return undefined
  const { accountUuid, emailAddress } = oauth as Record<string, unknown>
  if (typeof accountUuid !== 'string' || accountUuid === '') return undefined
  return { account: accountUuid, email: typeof emailAddress === 'string' && emailAddress !== '' ? emailAddress : null }
}

export interface AccountIdentitiesOptions {
  /** The file's text; `undefined` — there is none. */
  read?: (file: string) => string | undefined
  intervalMs?: number
  now?: () => number
}

const READ_EVERY_MS = 30_000

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * The accounts of the Claude folders, each read again at most once per interval: the machine's facts ask several times
 * a second, and a sign-in changes rarely.
 */
export class AccountIdentities {
  private readonly cache = new Map<string, { at: number; value: ClaudeAccount | undefined }>()
  private readonly read: (file: string) => string | undefined
  private readonly intervalMs: number
  private readonly now: () => number

  constructor(options: AccountIdentitiesOptions = {}) {
    this.read = options.read ?? readText
    this.intervalMs = options.intervalMs ?? READ_EVERY_MS
    this.now = options.now ?? Date.now
  }

  of(file: string): ClaudeAccount | undefined {
    const now = this.now()
    const cached = this.cache.get(file)
    if (cached !== undefined && now - cached.at < this.intervalMs) return cached.value
    const text = this.read(file)
    const value = text === undefined ? undefined : claudeAccountOf(text)
    this.cache.set(file, { at: now, value })
    return value
  }
}
