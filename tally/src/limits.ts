import { limitsFileDir, parseLimitsFile, type LimitWindow, type RateLimits } from '../../src/limits/model.js'

export type WindowName = '5h' | '7d'

export interface Snapshot {
  account: string
  window: WindowName
  observedAt: string
  usedPercentage: number
  resetsAt: string
  source: string
}

export function snapshotsOfState(state: unknown): Snapshot[] {
  const accounts = (state as { account?: { accounts?: unknown } } | null)?.account?.accounts
  if (!Array.isArray(accounts)) return []
  return accounts.flatMap((account: { key?: unknown; limits?: RateLimits | null }) =>
    typeof account?.key === 'string' && account.limits ? snapshotsOf(account.key, account.limits) : [],
  )
}

export function snapshotsOfFile(raw: unknown, ownerOf: (configDir: string | null) => string | undefined): Snapshot[] {
  const limits = parseLimitsFile(raw)
  const account = ownerOf(limitsFileDir(raw))
  return limits === undefined || account === undefined ? [] : snapshotsOf(account, limits)
}

function snapshotsOf(account: string, limits: RateLimits): Snapshot[] {
  const windows: [WindowName, LimitWindow | null | undefined][] = [
    ['5h', limits.fiveHour],
    ['7d', limits.sevenDay],
  ]
  return windows.flatMap(([window, value]) =>
    value && typeof value.usedPercentage === 'number' && typeof value.resetsAt === 'string' && typeof limits.updatedAt === 'string'
      ? [{ account, window, observedAt: limits.updatedAt, usedPercentage: value.usedPercentage, resetsAt: value.resetsAt, source: limits.source }]
      : [],
  )
}
