export interface LimitWindow {
  usedPercentage: number
  resetsAt: string
}

export interface RateLimits {
  fiveHour: LimitWindow | null
  sevenDay: LimitWindow | null
  updatedAt: string
}

export function parseLimitsFile(raw: unknown): RateLimits | undefined {
  if (!isRecord(raw) || !isRecord(raw.rate_limits)) return undefined
  const { receivedAt } = raw
  if (typeof receivedAt !== 'string' || Number.isNaN(Date.parse(receivedAt))) return undefined
  return {
    fiveHour: parseWindow(raw.rate_limits.five_hour),
    sevenDay: parseWindow(raw.rate_limits.seven_day),
    updatedAt: new Date(receivedAt).toISOString(),
  }
}

export function currentLimits(limits: RateLimits | undefined, now: Date): RateLimits | null {
  if (limits === undefined) return null
  const live = (window: LimitWindow | null) => (window !== null && Date.parse(window.resetsAt) > now.getTime() ? window : null)
  return { ...limits, fiveHour: live(limits.fiveHour), sevenDay: live(limits.sevenDay) }
}

export function exhaustedReset(limits: RateLimits | null): string | null {
  const resets = [limits?.fiveHour, limits?.sevenDay].flatMap((window) =>
    window !== null && window !== undefined && window.usedPercentage >= 100 ? [window.resetsAt] : [],
  )
  return resets.sort().at(-1) ?? null
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
