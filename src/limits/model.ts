import { claudeOverage, type Overage } from './overage.js'

export interface LimitWindow {
  usedPercentage: number
  resetsAt: string
  /** What is left of a counted allowance (Copilot's monthly requests): the page shows it instead of the percentage. */
  left?: number
  /** What a counted allowance of unknown size has spent so far (Copilot's billing, BTN-341). */
  used?: number
}

export interface RateLimits {
  fiveHour: LimitWindow | null
  sevenDay: LimitWindow | null
  /**
   * The monthly window — Codex's free plan's 30 days, Copilot's allowance to the 1st: absent for a plan without one,
   * `null` when it has one with no data.
   */
  month?: LimitWindow | null
  updatedAt: string
  /**
   * `sdk` — a `rate_limit_event` of a Claude session run through the SDK (`limitsOfRateLimitInfo`); `api` — asked of the
   * provider's own API (ChatGPT's usage, GitHub's Copilot allowance, BTN-341).
   */
  source: 'usage' | 'statusline' | 'sdk' | 'api'
  /** The subscription the limits are of (`chatgpt:<account id>`): two folders with the same one share their limits. */
  pool?: string
  /** Subscription extras with an independent timestamp; fresh evidence may stop managed paid usage. */
  overage?: Overage
  /** ChatGPT's answer says whether the account may send now (`rate_limit.allowed` and not `limit_reached`, BTN-530). */
  open?: boolean
}

/** The windows a session reported: one it did not name stays as it was known. */
export type SessionLimits = Partial<Pick<RateLimits, 'fiveHour' | 'sevenDay'>> & { overage?: Omit<Overage, 'updatedAt'> }

const SESSION_WINDOWS = { five_hour: 'fiveHour', seven_day: 'sevenDay' } as const

/**
 * The account's windows out of a `rate_limit_event`'s `rate_limit_info`, sent by the CLI at each response: the
 * utilization is a share, the reset is in seconds. `unifiedWindows` (CLI 2.1.308, not in `sdk.d.ts`) holds both windows;
 * without it only the documented `rateLimitType` window is read, and a refused one without utilization is spent.
 * Model-specific windows are not shown. Extra usage keeps only the availability and use the event actually reports.
 */
export function limitsOfRateLimitInfo(raw: unknown): SessionLimits | undefined {
  if (!isRecord(raw)) return undefined
  const limits: SessionLimits = {}
  const overage = claudeOverage(raw)
  if (overage !== undefined) limits.overage = overage
  if (isRecord(raw.unifiedWindows)) {
    for (const [type, span] of Object.entries(SESSION_WINDOWS)) {
      const window = sessionWindow(raw.unifiedWindows[type])
      if (window !== undefined) limits[span] = window
    }
  }
  const span = SESSION_WINDOWS[raw.rateLimitType as keyof typeof SESSION_WINDOWS]
  if (span !== undefined) {
    const utilization = raw.utilization ?? (raw.status === 'rejected' ? 1 : undefined)
    const window = sessionWindow({ utilization, resetsAt: raw.resetsAt })
    if (window !== undefined) limits[span] = window
  }
  return Object.keys(limits).length === 0 ? undefined : limits
}

export function withSessionLimits(known: RateLimits | undefined, reported: SessionLimits, at: string): RateLimits {
  return {
    fiveHour: reported.fiveHour ?? known?.fiveHour ?? null,
    sevenDay: reported.sevenDay ?? known?.sevenDay ?? null,
    updatedAt: at,
    source: 'sdk',
    ...(reported.overage !== undefined ? { overage: { ...reported.overage, updatedAt: at } } : known?.overage !== undefined ? { overage: known.overage } : {}),
  }
}

function sessionWindow(raw: unknown): LimitWindow | undefined {
  if (!isRecord(raw) || !isFiniteNumber(raw.utilization) || !isFiniteNumber(raw.resetsAt)) return undefined
  return { usedPercentage: Math.round(raw.utilization * 1000) / 10, resetsAt: new Date(raw.resetsAt * 1000).toISOString() }
}

export type LimitSpan = 'fiveHour' | 'sevenDay' | 'month'

/**
 * The windows the account's plan has, in the order they are shown: five hours and a week unless the plan is monthly. The
 * provider's own answer (`api`) lists every window the plan has, so one it left out while giving another is not there
 * (ChatGPT Pro has no five hours), rather than a window with no data.
 */
export function limitSpans(limits: RateLimits | null | undefined): LimitSpan[] {
  if (limits?.month === undefined) {
    const spans = ['fiveHour', 'sevenDay'] as const
    const given = spans.filter((span) => limits?.[span] != null)
    return limits?.source === 'api' && given.length > 0 ? given : [...spans]
  }
  return [...(['fiveHour', 'sevenDay'] as const).filter((span) => limits[span] !== null), 'month']
}

export function parseLimitsFile(raw: unknown): RateLimits | undefined {
  if (!isRecord(raw) || !isRecord(raw.rate_limits)) return undefined
  const { receivedAt } = raw
  if (typeof receivedAt !== 'string' || Number.isNaN(Date.parse(receivedAt))) return undefined
  return {
    fiveHour: parseWindow(raw.rate_limits.five_hour),
    sevenDay: parseWindow(raw.rate_limits.seven_day),
    updatedAt: new Date(receivedAt).toISOString(),
    source: 'statusline',
  }
}

export function limitsFileDir(raw: unknown): string | null {
  if (!isRecord(raw) || typeof raw.configDir !== 'string' || raw.configDir === '') return null
  return raw.configDir
}

export function currentLimits(limits: RateLimits | undefined, now: Date, notBefore: string | null = null): RateLimits | null {
  if (limits === undefined) return null
  if (notBefore !== null && Date.parse(limits.updatedAt) < Date.parse(notBefore)) return null
  const live = (window: LimitWindow | null) => (window !== null && Date.parse(window.resetsAt) > now.getTime() ? window : null)
  const current = { ...limits, fiveHour: live(limits.fiveHour), sevenDay: live(limits.sevenDay) }
  if (notBefore !== null && current.overage !== undefined && Date.parse(current.overage.updatedAt) < Date.parse(notBefore)) delete current.overage
  return limits.month === undefined ? current : { ...current, month: live(limits.month) }
}

export function newestLimits(a: RateLimits | undefined, b: RateLimits | undefined): RateLimits | undefined {
  if (a === undefined || b === undefined) return a ?? b
  const latest = Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a
  const extra = a.overage === undefined ? b.overage : b.overage === undefined ? a.overage :
    Date.parse(b.overage.updatedAt) > Date.parse(a.overage.updatedAt) ? b.overage : a.overage
  return extra === undefined ? latest : { ...latest, overage: extra }
}

export function exhaustedReset(limits: RateLimits | null): string | null {
  const resets = [limits?.fiveHour, limits?.sevenDay, limits?.month].flatMap((window) =>
    window !== null && window !== undefined && window.usedPercentage >= 100 ? [window.resetsAt] : [],
  )
  return resets.sort().at(-1) ?? null
}

const FIVE_HOURS_MS = 5 * 60 * 60_000
/** How near the named reset a window's own reset still counts as that window: a refusal names it to the hour or minute. */
const SAME_WINDOW_MS = 60 * 60_000

/**
 * When a poll of the account, taken after the refusal at `at`, shows the spent window open before the reset the hold
 * named (BTN-530): providers now and then reset limits early. ChatGPT's answer says so itself; a Claude `/usage` reading
 * counts when no window is spent and none runs out near `resetsAt`, as a window started over resets later. A statusline,
 * a session event or an answer that does not say keep the wait. `null` — not open again; otherwise the poll's time.
 */
export function limitReopenedAt(limits: RateLimits | null, at: string, resetsAt: string): string | null {
  if (limits === null || Date.parse(limits.updatedAt) <= Date.parse(at)) return null
  if (limits.source === 'api') return limits.open === true ? limits.updatedAt : null
  if (limits.source !== 'usage') return null
  const named = Date.parse(resetsAt)
  const windows = [limits.fiveHour, limits.sevenDay, limits.month].filter((window) => window != null)
  const spent = windows.some((window) => window.usedPercentage >= 100 || Math.abs(Date.parse(window.resetsAt) - named) < SAME_WINDOW_MS)
  return spent ? null : limits.updatedAt
}

/**
 * When a limit the account hit at `at` resets, for a limit whose text gave no time — the CLI's `wrap_up` warning
 * comes before the window shows 100%. Without an exhausted window it is the end of the five-hour window the limit
 * fell into, or the start of a newer one; `null` until the account's limits are newer than the limit. A statusline
 * snapshot may leave the five-hour window out, so only `/usage` saying it has not started counts as a reset.
 */
export function limitResetAfter(limits: RateLimits | null, at: string): string | null {
  const exhausted = exhaustedReset(limits)
  if (exhausted !== null) return exhausted
  if (limits === null || Date.parse(limits.updatedAt) <= Date.parse(at)) return null
  // A monthly plan with no five-hour window waits for the month: under 100% only means the snapshot lags behind, unless
  // the allowance is counted — then something left is something left.
  if (limits.month !== undefined && limits.fiveHour === null) {
    if (limits.month?.left !== undefined && limits.month.left > 0) return limits.updatedAt
    return limits.month?.resetsAt ?? null
  }
  const window = limits.fiveHour
  if (window === null) return limits.source === 'usage' ? limits.updatedAt : null
  const start = Date.parse(window.resetsAt) - FIVE_HOURS_MS
  return start > Date.parse(at) ? new Date(start).toISOString() : window.resetsAt
}

function parseWindow(raw: unknown): LimitWindow | null {
  if (!isRecord(raw)) return null
  const { used_percentage: used, resets_at: resetsAt } = raw
  if (!isFiniteNumber(used) || !isFiniteNumber(resetsAt)) return null
  return { usedPercentage: used, resetsAt: new Date(resetsAt * 1000).toISOString() }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
