export interface LimitWindow {
  usedPercentage: number
  resetsAt: string
}

export interface RateLimits {
  fiveHour: LimitWindow | null
  sevenDay: LimitWindow | null
  /** The 30-day window of Codex's free plan: absent for a plan without one, `null` when it has one with no data. */
  month?: LimitWindow | null
  updatedAt: string
  /** `sdk` — a `rate_limit_event` of a Claude session run through the SDK (`limitsOfRateLimitInfo`). */
  source: 'usage' | 'statusline' | 'sdk'
}

/** The windows a session reported: one it did not name stays as it was known. */
export type SessionLimits = Partial<Pick<RateLimits, 'fiveHour' | 'sevenDay'>>

const SESSION_WINDOWS = { five_hour: 'fiveHour', seven_day: 'sevenDay' } as const

/**
 * The account's windows out of a `rate_limit_event`'s `rate_limit_info`, sent by the CLI at each response: the
 * utilization is a share, the reset is in seconds. `unifiedWindows` (CLI 2.1.308, not in `sdk.d.ts`) holds both windows;
 * without it only the documented `rateLimitType` window is read, and a refused one without utilization is spent.
 * The models' and the overage windows are not shown.
 */
export function limitsOfRateLimitInfo(raw: unknown): SessionLimits | undefined {
  if (!isRecord(raw)) return undefined
  const limits: SessionLimits = {}
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
  }
}

function sessionWindow(raw: unknown): LimitWindow | undefined {
  if (!isRecord(raw) || !isFiniteNumber(raw.utilization) || !isFiniteNumber(raw.resetsAt)) return undefined
  return { usedPercentage: Math.round(raw.utilization * 1000) / 10, resetsAt: new Date(raw.resetsAt * 1000).toISOString() }
}

export type LimitSpan = 'fiveHour' | 'sevenDay' | 'month'

/** The windows the account's plan has, in the order they are shown: five hours and a week unless the plan is monthly. */
export function limitSpans(limits: RateLimits | null | undefined): LimitSpan[] {
  if (limits?.month === undefined) return ['fiveHour', 'sevenDay']
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
  return limits.month === undefined ? current : { ...current, month: live(limits.month) }
}

export function newestLimits(a: RateLimits | undefined, b: RateLimits | undefined): RateLimits | undefined {
  if (a === undefined || b === undefined) return a ?? b
  return Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a
}

export function exhaustedReset(limits: RateLimits | null): string | null {
  const resets = [limits?.fiveHour, limits?.sevenDay, limits?.month].flatMap((window) =>
    window !== null && window !== undefined && window.usedPercentage >= 100 ? [window.resetsAt] : [],
  )
  return resets.sort().at(-1) ?? null
}

const FIVE_HOURS_MS = 5 * 60 * 60_000

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
  // A monthly plan with no five-hour window waits for the month: under 100% only means the snapshot lags behind.
  if (limits.month !== undefined && limits.fiveHour === null) return limits.month?.resetsAt ?? null
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
