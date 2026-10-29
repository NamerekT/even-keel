import type { RateLimits } from './model.js'

/** Provider facts only: availability is not consent to spend, and credits are not dollars. */
export interface Overage {
  source: 'claude-sdk' | 'chatgpt' | 'github-quota' | 'github-billing'
  updatedAt: string
  unit?: 'credits' | 'USD'
  balance?: number
  used?: number
  available?: boolean
  unlimited?: boolean
  using?: boolean
  enabled?: boolean
  count?: number
}

export function chatGptCredits(raw: unknown, at: string): Overage | undefined {
  if (!isRecord(raw) || typeof raw.has_credits !== 'boolean' || typeof raw.unlimited !== 'boolean') return undefined
  const balance = typeof raw.balance === 'string' && /^-?\d+(\.\d+)?$/.test(raw.balance) ? Number(raw.balance) : undefined
  return { source: 'chatgpt', updatedAt: at, unit: 'credits', available: raw.has_credits, unlimited: raw.unlimited,
    ...(balance !== undefined && Number.isFinite(balance) ? { balance } : {}) }
}

export function claudeOverage(raw: Record<string, unknown>): Omit<Overage, 'updatedAt'> | undefined {
  const status = raw.overageStatus ?? (raw.rateLimitType === 'overage' ? raw.status : undefined)
  const available = status === 'allowed' || status === 'allowed_warning' ? true : status === 'rejected' ? false : undefined
  const using = typeof raw.isUsingOverage === 'boolean' ? raw.isUsingOverage : undefined
  if (available === undefined && using === undefined) return undefined
  return { source: 'claude-sdk', ...(available !== undefined && { available }), ...(using !== undefined && { using }) }
}

export function copilotOverage(quota: Record<string, unknown>, at: string): Overage | undefined {
  if (typeof quota.overage_permitted !== 'boolean') return undefined
  return { source: 'github-quota', updatedAt: at, enabled: quota.overage_permitted,
    ...(typeof quota.overage_count === 'number' && Number.isFinite(quota.overage_count) && quota.overage_count >= 0 ? { count: quota.overage_count } : {}) }
}

export function githubOverage(items: unknown[], at: string): Overage | undefined {
  const copilot = items.filter((item) => isRecord(item) && typeof item.product === 'string' && item.product.toLowerCase() === 'copilot')
  if (copilot.length === 0 || !copilot.every((item) => isRecord(item) && typeof item.netAmount === 'number' && Number.isFinite(item.netAmount) && item.netAmount >= 0)) return undefined
  const used = copilot.reduce((sum: number, item) => sum + (item as { netAmount: number }).netAmount, 0)
  return { source: 'github-billing', updatedAt: at, unit: 'USD', used: Math.round(used * 100) / 100 }
}

/** A current spend indicator, not a historical receipt or an inference from an idle session's exhausted window. */
export function usingOverage(entry: { agent: string; needsLogin: boolean; working?: boolean; limits: RateLimits | null }, now: Date): boolean {
  const extra = entry.limits?.overage
  if (extra === undefined || entry.needsLogin || entry.working !== true) return false
  const age = now.getTime() - Date.parse(extra.updatedAt)
  if (!(age >= 0 && age <= 10 * 60_000)) return false
  if (extra.source === 'claude-sdk') return extra.using === true
  if (extra.source !== 'chatgpt' || !['codex', 'opencode'].includes(entry.agent) || !(extra.available || extra.unlimited)) return false
  return [entry.limits?.fiveHour, entry.limits?.sevenDay, entry.limits?.month]
    .some((window) => window != null && window.usedPercentage >= 100 && Date.parse(window.resetsAt) > now.getTime())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
