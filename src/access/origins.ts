import { fail } from '../notice/notice.js'
import type { Db } from '../storage/database.js'
import type { KnownOrigin } from './view.js'

/** How often an origin's `seen_at` reaches the database; the memory has it at once. */
export const ORIGIN_WRITE_MS = 60_000
/** An origin not seen for this long is not offered any more: the page moved to another name. */
export const ORIGIN_KEPT_MS = 90 * 24 * 60 * 60 * 1000

export interface OriginsOptions {
  clock?: () => Date
  log?: (line: string) => void
}

interface OriginRow {
  origin: string
  seen_at: string
}

/**
 * The page's outside addresses (BTN-1661, `docs/web/sign-in.md`, "Invitations"): the `Origin` of every request the
 * guard let in by a name other than loopback, and the addresses typed in the invitation dialog. An invitation made on
 * a page opened by `localhost` links to one of them. Held in memory, loaded from `page_origins` at the start.
 */
export class PageOrigins {
  private readonly seenAt = new Map<string, string>()
  private readonly written = new Map<string, number>()
  private pending: Promise<unknown> = Promise.resolve()

  private constructor(
    private readonly db: Db,
    private readonly options: OriginsOptions,
  ) {}

  static async load(db: Db, options: OriginsOptions = {}): Promise<PageOrigins> {
    const origins = new PageOrigins(db, options)
    const { rows } = await db.query<OriginRow>('select origin, seen_at from page_origins')
    for (const row of rows) origins.seenAt.set(row.origin, row.seen_at)
    return origins
  }

  /** A request the guard let in came with this `Origin`: noted unless it names this machine. */
  seen(header: string | undefined): void {
    const origin = externalOrigin(header)
    if (origin === undefined) return
    const now = this.now()
    this.seenAt.set(origin, now.toISOString())
    if (now.getTime() - (this.written.get(origin) ?? 0) < ORIGIN_WRITE_MS) return
    this.written.set(origin, now.getTime())
    this.write(origin, this.store(origin, now))
  }

  /** An address typed in the invitation dialog: kept as the last one seen; the origin it was read as. */
  async remember(typed: string): Promise<string> {
    const origin = typedOrigin(typed)
    const now = this.now()
    this.seenAt.set(origin, now.toISOString())
    this.written.set(origin, now.getTime())
    await this.store(origin, now)
    return origin
  }

  /** The origins seen within `ORIGIN_KEPT_MS`, the last one first. */
  list(): KnownOrigin[] {
    const since = this.now().getTime() - ORIGIN_KEPT_MS
    return [...this.seenAt]
      .filter(([, seenAt]) => Date.parse(seenAt) >= since)
      .sort(([a, at], [b, bt]) => bt.localeCompare(at) || a.localeCompare(b))
      .map(([origin, seenAt]) => ({ origin, seenAt }))
  }

  /** The writes in flight are done: for tests and the service's stop. */
  async settled(): Promise<void> {
    await this.pending
  }

  private async store(origin: string, at: Date): Promise<void> {
    await this.db.query('insert into page_origins (origin, seen_at) values ($1, $2) on conflict (origin) do update set seen_at = excluded.seen_at', [origin, at.toISOString()])
  }

  private write(origin: string, done: Promise<unknown>): void {
    this.pending = this.pending.then(() => done).catch((error: unknown) => {
      ;(this.options.log ?? console.warn)(`access: the page origin ${origin} not written: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  private now(): Date {
    return this.options.clock?.() ?? new Date()
  }
}

/** The origin of an `Origin` header by a name another device may reach; `undefined` — none, or this machine's. */
export function externalOrigin(header: string | undefined): string | undefined {
  if (header === undefined || header === '') return undefined
  const url = urlOf(header)
  if (url === undefined || localName(url.hostname)) return undefined
  return url.origin
}

/** The origin of an address a person typed: `https://` when it names no scheme. Refused for loopback or no address. */
export function typedOrigin(typed: string): string {
  const text = typed.trim()
  const url = text === '' ? undefined : urlOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  if (url === undefined || url.username !== '' || url.password !== '') throw fail('auth.inviteOriginBad', {})
  if (localName(url.hostname)) throw fail('auth.inviteOriginLocal', {})
  return url.origin
}

function urlOf(text: string): URL | undefined {
  try {
    const url = new URL(text)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '' ? url : undefined
  } catch {
    return undefined
  }
}

/** A name that reaches only this machine, or no machine at all. */
function localName(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '')
  return name === 'localhost' || name.endsWith('.localhost') || name === '::1' || name === '::' || name === '0.0.0.0' || /^127\./.test(name)
}
