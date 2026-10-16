export interface LimitWindow {
  usedPercentage: number
  resetsAt: string
}

export interface RateLimits {
  fiveHour: LimitWindow | null
  sevenDay: LimitWindow | null
  updatedAt: string
  source: 'usage' | 'statusline'
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
  return { ...limits, fiveHour: live(limits.fiveHour), sevenDay: live(limits.sevenDay) }
}

export function newestLimits(a: RateLimits | undefined, b: RateLimits | undefined): RateLimits | undefined {
  if (a === undefined || b === undefined) return a ?? b
  return Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a
}

export function exhaustedReset(limits: RateLimits | null): string | null {
  const resets = [limits?.fiveHour, limits?.sevenDay].flatMap((window) =>
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
