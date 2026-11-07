import type { SessionView } from '../state.js'

export const BOOT_WAIT_MS = 5 * 60_000

/** A waiting CLI that has not received its first prompt yet, within the page's boot grace. */
export function idleBeforePrompt(view: SessionView, now: Date): boolean {
  const age = now.getTime() - Date.parse(view.startedAt)
  return view.lamp === 'waiting' && view.contextTokens === 0 && view.feed.length === 0 && !view.asking
    && view.startupDialog === null && view.apiError === null && age <= BOOT_WAIT_MS
}
