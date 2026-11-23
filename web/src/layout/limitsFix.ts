import { useSyncExternalStore } from 'react'
import type { LimitWindow } from '../../../src/limits/model.js'
import { useLive } from '../live/context.js'
import { useMachineFilter } from './MachineFilter.js'

/*
 * The idle panel's limits chat (BTN-1510) takes the header's limit segments away for a while: the panel says when, the
 * segments hide with `visibility`, so the header keeps its place. Nothing else changes and nothing is kept.
 */
let gone = false
const listeners = new Set<() => void>()

export function setLimitsGone(value: boolean): void {
  if (gone === value) return
  gone = value
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLimitsGone(): boolean {
  return useSyncExternalStore(subscribe, () => gone)
}

/**
 * The five-hour window of the account the header shows on project `project`'s page, as `Header` picks it: the project's
 * first launch level or the Even Keel account; in a machine elsewhere's view that machine's launch account; none in "All
 * machines", whose toggle has no limits.
 */
export function useHeaderFiveHour(project: string): { window: LimitWindow | null; outdated: boolean } | null {
  const { state } = useLive()
  const machines = useMachineFilter()
  if (state === null) return null
  const picked = machines.selected
  if (!machines.shown || picked?.own === true) {
    const key = state.account.headerLevels?.[project]?.[0]?.account ?? state.account.active
    const entry = state.account.accounts.find((account) => account.key === key)
    return entry === undefined ? null : { window: entry.limits?.fiveHour ?? null, outdated: entry.limitsOutdated === true }
  }
  if (picked === null) return null
  const active = picked.accounts.find((account) => account.key === picked.active) ?? picked.accounts.find((account) => account.signedIn)
  return active === undefined ? null : { window: active.limits?.fiveHour ?? null, outdated: false }
}
